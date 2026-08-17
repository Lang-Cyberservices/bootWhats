require('dotenv').config();

const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const MessageFilter = require('./services/MessageFilter');
const MediaIngest = require('./services/MediaIngest');
const VerdictDispatcher = require('./services/VerdictDispatcher');
const CommandHandler = require('./services/CommandHandler');
const AuditLogger = require('./services/AuditLogger');
const OracleService = require('./services/OracleService');
const DiceRoller = require('./services/DiceRoller');
const { handleGroupJoin } = require('./services/WelcomeService');
const { connectDatabase } = require('./services/database');
const StatsCounter = require('./services/StatsCounter');
const { getSenderId } = require('./services/messageUtils');
const LlamaResponder = require('./services/LlamaResponder');
const ForcaGame = require('./services/games/forca');
const XadrezGame = require('./services/games/xadrez');
const BlockedCommands = require('./services/BlockedCommands');

const isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';
const devGroupId = (process.env.DEV_GROUP_ID || '').trim();
// O pin de versão vale só para o carregamento inicial: com sessão ativa o
// WhatsApp Web se auto-atualiza para a build mais nova em seguida. A
// compatibilidade com as builds 2.3000.1043xxx (renomeação `_serialized`→`$1`)
// vem do fork do whatsapp-web.js com o PR wwebjs#201840; quando a correção
// sair no npm, voltar a dependência para a versão oficial no package.json.
const webVersion = (process.env.WWEB_VERSION || '2.3000.1043287716').trim();
const ingestPort = Number(process.env.HTTP_INGEST_PORT) || 5000;
const ingestKey = (process.env.HTTP_INGEST_KEY || '').trim();
const ingestGroupId = (process.env.HTTP_INGEST_GROUP_ID || '').trim();
const puppeteerProtocolTimeoutMs = Number(process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS) || 300000;
let seenGroupIdsInDev = null;
let isClientReady = false;
let botReadyAt = null;

// `queue` (padrão): a análise roda no processo bootwhats-analyzer e o bot só
// enfileira. `inline`: volta ao comportamento antigo, analisando dentro do bot —
// serve como escape em produção sem precisar de redeploy.
const analysisMode = (process.env.IMAGE_ANALYSIS_MODE || 'queue').toLowerCase();
let mediaIngest;
let verdictDispatcher;
const auditLogger = new AuditLogger();
const oracleService = new OracleService(auditLogger);
const diceRoller = new DiceRoller();

const messageFilter = new MessageFilter(['ofensa1', 'spamlink'], auditLogger);
const forcaGame = new ForcaGame();
const xadrezGame = new XadrezGame();
const blockedCommands = new BlockedCommands();
const commandHandler = new CommandHandler(auditLogger, oracleService, diceRoller, forcaGame, blockedCommands, xadrezGame);
commandHandler.setBotReadyAt(() => botReadyAt);
let statsCounter;
const llamaResponder = new LlamaResponder({ auditLogger });

const MAX_INIT_ATTEMPTS = 10;
const WATCHDOG_INTERVAL_MS = 10 * 60_000;
const DESTROY_TIMEOUT_MS = Number(process.env.CLIENT_DESTROY_TIMEOUT_MS) || 30_000;
let watchdogTimer = null;
let reconnectPromise = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `client.destroy()` chama browser.close(), que trava para sempre quando o
// Chromium não responde — e é justamente aí que a reconexão é acionada. Sem o
// timeout + SIGKILL abaixo, cada reconexão deixava um Chromium vivo queimando CPU
// até o fim dos tempos.
async function destroyClient() {
    try {
        await Promise.race([
            client.destroy(),
            sleep(DESTROY_TIMEOUT_MS).then(() => {
                throw new Error(`destroy não respondeu em ${DESTROY_TIMEOUT_MS}ms`);
            })
        ]);
    } catch (err) {
        console.warn('⚠️ Falha ao encerrar o cliente:', err?.message || err);
    }

    killBrowserProcess();
}

function killBrowserProcess() {
    let proc;
    try {
        proc = client.pupBrowser?.process?.();
    } catch (_) {
        proc = null;
    }
    if (!proc || proc.killed || proc.exitCode !== null) return;

    console.warn(`🔪 Chromium (pid ${proc.pid}) sobreviveu ao destroy — matando.`);
    try {
        proc.kill('SIGKILL');
    } catch (err) {
        console.warn('⚠️ Não consegui matar o Chromium:', err?.message || err);
    }
}

// Laço em vez de setTimeout recursivo: cada tentativa fracassada pode ter deixado
// um browser meio aberto, então destruímos antes de tentar de novo.
async function startClientWithRetry() {
    for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
        try {
            await client.initialize();
            return true;
        } catch (err) {
            const delayMs = Math.min(30000, 2000 * attempt);
            console.error(
                `❌ Falha ao inicializar o WhatsApp Web (tentativa ${attempt}/${MAX_INIT_ATTEMPTS}).`,
                err?.message || err
            );
            await destroyClient();
            if (attempt === MAX_INIT_ATTEMPTS) break;
            console.error(`🔁 Tentando novamente em ${Math.round(delayMs / 1000)}s...`);
            await sleep(delayMs);
        }
    }

    console.error(`❌ ${MAX_INIT_ATTEMPTS} tentativas esgotadas. Intervenção manual necessária.`);
    return false;
}

// O watchdog e o evento 'disconnected' podem disparar juntos. Sem esta trava,
// duas reconexões simultâneas abriam dois Chromium.
function triggerClientReconnect() {
    if (reconnectPromise) {
        console.log('⏳ Reconexão já em andamento — ignorando pedido duplicado.');
        return reconnectPromise;
    }

    reconnectPromise = (async () => {
        isClientReady = false;
        await destroyClient();
        await startClientWithRetry();
    })().finally(() => {
        reconnectPromise = null;
    });

    return reconnectPromise;
}

async function checkClientHealth() {
    if (!isClientReady) return;
    try {
        const state = await Promise.race([
            client.getState(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('watchdog-timeout')), 30_000)
            )
        ]);
        if (state !== 'CONNECTED') {
            console.warn(`⚠️ Watchdog: estado "${state}" inesperado. Reconectando...`);
            await triggerClientReconnect();
        }
    } catch (err) {
        console.warn('⚠️ Watchdog: cliente sem resposta —', err.message, '— Reconectando...');
        await triggerClientReconnect();
    }
}

function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        checkClientHealth().catch((err) =>
            console.error('Watchdog: erro inesperado:', err?.message || err)
        );
    }, WATCHDOG_INTERVAL_MS);
    watchdogTimer.unref?.();
}




// Função para carregar o modelo de forma assíncrona antes de tudo
async function init() {
    try {
        await connectDatabase();
    } catch (e) {
        // `connectDatabase` já imprime uma mensagem amigável em produção.
        // Aqui evitamos printar o objeto inteiro (que vira um stack enorme).
        const msg = (e && typeof e === 'object' && 'message' in e) ? e.message : String(e);
        console.error(`❌ ${msg}`);
        // Mesmo sem banco, não inicializamos o bot, pois ele depende fortemente do Prisma.
        return;
    }

    statsCounter = new StatsCounter({
        flushIntervalMs: Number(process.env.STATS_FLUSH_INTERVAL_MS) || undefined,
        maxBuffer: Number(process.env.STATS_MAX_BUFFER) || undefined
    });

    await forcaGame.loadActiveGames();
    await xadrezGame.loadActiveGames();
    await blockedCommands.load();

    mediaIngest = new MediaIngest({
        auditLogger,
        blockedCommands,
        evidenceDir: process.env.NSFW_EVIDENCE_DIR,
        inlineAnalyzer: analysisMode === 'inline' ? await loadInlineAnalyzer() : null
    });

    if (analysisMode === 'inline') {
        console.warn('⚠️ IMAGE_ANALYSIS_MODE=inline: analisando dentro do processo do bot.');
    } else {
        verdictDispatcher = new VerdictDispatcher({ client, auditLogger, mediaIngest });
        console.log('🖼️ Análise de imagens delegada ao worker (fila no banco).');
    }

    await startClientWithRetry();
}

// Só usado no modo inline. Em `queue` o bot nunca carrega tfjs-node — é o que
// mantém o event loop livre para o Puppeteer.
async function loadInlineAnalyzer() {
    try {
        const nsfw = require('nsfwjs');
        const ImageAnalyzer = require('./services/ImageAnalyzer');
        const LaionClient = require('./services/analyzer/LaionClient');
        const model = await nsfw.load('file://./models/inception_v3/', {
            type: 'inception_v3',
            size: 299
        });
        console.log('✅ Modelo de IA carregado e pronto!');
        return new ImageAnalyzer(model, { inputSize: 299, laionClient: new LaionClient() });
    } catch (e) {
        // Sem modelo o bot segue funcionando, só sem moderação de imagem.
        console.error('❌ Erro ao carregar o modelo de IA:', e);
        return null;
    }
}

const client = new Client({
    authStrategy: new LocalAuth(),
    webVersion,
    webVersionCache: {
        type: 'local',
        path: './.wwebjs_cache',
        strict: false
    },
    puppeteer: {
        protocolTimeout: puppeteerProtocolTimeoutMs,
        args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--disable-gpu'
    ],
        headless: true
    }
});
commandHandler.setClient(client);
forcaGame.setClient(client);
xadrezGame.setClient(client);

// O WhatsApp Web é um PWA: com sessão existente, o service worker serve a
// página do próprio cache e a versão fixada em `webVersion` é ignorada.
// O bypass abaixo força a requisição de rede, permitindo que a lib
// intercepte e sirva o HTML fixado do .wwebjs_cache.
const origInitWebVersionCache = client.initWebVersionCache.bind(client);
client.initWebVersionCache = async () => {
    try {
        const cdp = await client.pupPage.createCDPSession();
        await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    } catch (err) {
        console.warn('⚠️ Falha ao ativar bypass do service worker:', err?.message || err);
    }
    return origInitWebVersionCache();
};

startIngestServer();

client.on('qr', (qr) => {
    qrcode.generate(qr, {small: true});
});

client.on('ready',  async() => {
    isClientReady = true;
    botReadyAt = Date.now();
    console.log('🚀 Monitor de grupos ATIVADO!');
    try {
        console.log('📱 Versão do WhatsApp Web carregada:', await client.getWWebVersion());
    } catch (_) {}
    startWatchdog();
    verdictDispatcher?.start();
    if (isDev && devGroupId) {
        console.log(`🔧 Modo desenvolvimento: apenas o grupo ${devGroupId} será processado.`);
    }
    const myNumber = (process.env.BOOT_NUMBER || '').trim();
    if (!myNumber) {
        console.warn('⚠️ BOOT_NUMBER não definido. Ignorando setBotId.');
        return;
    }
    // Retry com delay: o evento 'ready' pode disparar antes do layer de comms
    // interno do WhatsApp Web (startComms) estar pronto, causando sendIq errors.
    const numberId = await (async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
            await new Promise(r => setTimeout(r, 3000));
            try {
                return await client.getNumberId(myNumber);
            } catch (err) {
                console.warn(`⚠️ getNumberId falhou (tentativa ${attempt}/3):`, err.message);
            }
        }
        return null;
    })();
    if (numberId?._serialized) {
        llamaResponder.setBotId(numberId._serialized);
    } else {
        console.warn('⚠️ Não foi possível resolver o BOOT_NUMBER com getNumberId.');
    }
});

client.on('disconnected', async (reason) => {
    console.warn(`⚠️ WhatsApp desconectado. Motivo: ${reason}`);
    isClientReady = false;
    if (reason === 'LOGOUT') {
        console.error('🔒 Sessão encerrada pelo WhatsApp (LOGOUT). Escaneie o QR novamente.');
        return;
    }
    console.log('🔁 Reconectando em 10s...');
    setTimeout(triggerClientReconnect, 10_000);
});

client.on('auth_failure', (message) => {
    console.error(`❌ Falha de autenticação: ${message}. Escaneie o QR novamente.`);
    isClientReady = false;
});

client.on('change_state', (state) => {
    console.log(`📶 Estado: ${state}`);
});

client.on('message', async (msg) => {
    if (typeof msg.from === 'string' && msg.from.endsWith('@newsletter')) {
        return; // Ignora mensagens de canais para evitar bug no ChatFactory
    }



    let chat;
    try {
        chat = await msg.getChat();
    } catch (e) {
        console.error(
            'Erro ao obter chat da mensagem:',
            e?.message || e,
            '| from:', msg.from,
            '| author:', msg.author || '-',
            '| type:', msg.type,
            '| body:', String(msg.body || '').slice(0, 40)
        );
        return;
    }

    if (!chat?.isGroup) return;

    const chatId = chat?.id?._serialized || chat?.id?.user || '';
    // Em desenvolvimento: processar apenas o grupo definido em DEV_GROUP_ID
    if (isDev && devGroupId) {
        if (chatId !== devGroupId) return;
    } else{
        if (chatId === devGroupId) return;
    }
    const body = String(msg.body || '');
    const isCommand = body.trim().startsWith('/');
    const authorId = getSenderId(msg);
    let authorPhone = msg._authorPhone || null;
    if (!authorPhone) {
        try {
            const contact = await msg.getContact();
            authorPhone = contact?.number || null;
        } catch (e) {
            authorPhone = null;
        }
    }
    statsCounter?.trackMessage({
        chatId,
        authorId,
        phone: authorPhone,
        isCommand
    });

    // await messageFilter.handle(msg, chat);
    await mediaIngest?.handle(msg, chat);
    await commandHandler.handle(msg, chat);
    if (!isCommand) {
        await forcaGame.handleMessage(msg, chat);
        await xadrezGame.handleMessage(msg, chat);
    }
    await llamaResponder.handleMessage(msg, chat);
});

client.on('group_join', async (notification) => {
    let chat;
    try {
        chat = await notification.getChat();
    } catch (e) {
        console.error('Erro ao obter chat do group_join:', e);
        return;
    }

    if (!chat?.isGroup) return;

    const chatId = chat?.id?._serialized || chat?.id?.user || '';

    // Em desenvolvimento: processar apenas o grupo definido em DEV_GROUP_ID
    if (isDev && devGroupId) {
        if (chatId !== devGroupId) return;
    } else  {
        if (chatId === devGroupId) return;
    }

    await handleGroupJoin(notification, chat, { auditLogger });
});

function respondAsClosedPort(res) {
    return res.status(404).type('text/plain').send('');
}

function isValidIngestPayload(payload) {
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') return false;
    const keys = Object.keys(payload);
    if (keys.length !== 2 || !keys.includes('message') || !keys.includes('key')) return false;
    if (typeof payload.message !== 'string' || !payload.message.trim()) return false;
    if (typeof payload.key !== 'string') return false;
    return true;
}

function startIngestServer() {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ strict: true, limit: '8kb', type: 'application/json' }));

    app.post('/', async (req, res) => {
        if (!ingestKey || !ingestGroupId) {
            return respondAsClosedPort(res);
        }

        if (!isValidIngestPayload(req.body) || req.body.key !== ingestKey) {
            return respondAsClosedPort(res);
        }

        if (!isClientReady) {
            return res.status(503).json({ error: 'client_not_ready' });
        }

        try {

            msg= "Esta é uma mensagem teste enviada pela API: " + req.body.message.trim();
            await client.sendMessage(ingestGroupId, msg);
            return res.status(202).json({ ok: true });
        } catch (e) {
            console.error('Erro ao enviar mensagem da API HTTP:', e);
            return res.status(500).json({ error: 'send_failed' });
        }
    });

    app.use((err, req, res, next) => {
        return respondAsClosedPort(res);
    });

    app.use((req, res) => {
        return respondAsClosedPort(res);
    });

    app.listen(ingestPort, () => {
        console.log(`🌐 API HTTP ativa na porta ${ingestPort}`);
    });
}

// Sem isto, um `pm2 restart` mata o Node e o Chromium fica órfão, segurando CPU
// e memória até alguém reparar.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n👋 ${signal} recebido, encerrando o bot...`);
        verdictDispatcher?.stop();
        await destroyClient();
        process.exit(0);
    });
}
process.on('exit', () => killBrowserProcess());

init(); // Inicia o carregamento da IA e depois o bot
