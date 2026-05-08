require('dotenv').config();

const express = require('express');
const qrcode = require('qrcode-terminal');
const nsfw = require('nsfwjs');
const MessageFilter = require('./services/MessageFilter');
const ImageAnalyzer = require('./services/ImageAnalyzer');
const CommandHandler = require('./services/CommandHandler');
const AuditLogger = require('./services/AuditLogger');
const OracleService = require('./services/OracleService');
const DiceRoller = require('./services/DiceRoller');
const { handleGroupJoin } = require('./services/WelcomeService');
const { connectDatabase } = require('./services/database');
const StatsCounter = require('./services/StatsCounter');
const { getSenderId } = require('./services/messageUtils');
const LlamaResponder = require('./services/LlamaResponder');
const { EvolutionApiClient } = require('./services/EvolutionApi');

const isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';
const devGroupId = (process.env.DEV_GROUP_ID || '').trim();
const debugEvolution = isDev || process.env.EVOLUTION_DEBUG === '1';
const ingestPort = Number(process.env.HTTP_INGEST_PORT) || 5000;
const ingestKey = (process.env.HTTP_INGEST_KEY || '').trim();
const ingestGroupId = (process.env.HTTP_INGEST_GROUP_ID || '').trim();
const evolutionWebhookSecret = (process.env.EVOLUTION_WEBHOOK_SECRET || '').trim();
const defaultWebhookUrl = isDev
    ? `http://host.docker.internal:${ingestPort}/evolution/webhook`
    : `http://127.0.0.1:${ingestPort}/evolution/webhook`;
const evolutionWebhookUrl = (process.env.EVOLUTION_WEBHOOK_URL || defaultWebhookUrl).trim();
const evolutionStatePollMs = Number(process.env.EVOLUTION_STATE_POLL_MS) || 15000;
let isClientReady = false;

let model;
let imageAnalyzer;
const auditLogger = new AuditLogger();
const oracleService = new OracleService(auditLogger);
const diceRoller = new DiceRoller();

const messageFilter = new MessageFilter(['ofensa1', 'spamlink'], auditLogger);
const commandHandler = new CommandHandler(auditLogger, oracleService, diceRoller);
let statsCounter;
const llamaResponder = new LlamaResponder({ auditLogger });
const client = new EvolutionApiClient({
    baseUrl: process.env.EVOLUTION_API_URL,
    globalApiKey: process.env.EVOLUTION_GLOBAL_API_KEY,
    instanceName: process.env.EVOLUTION_INSTANCE_NAME,
    instanceToken: process.env.EVOLUTION_INSTANCE_TOKEN,
    integration: process.env.EVOLUTION_INSTANCE_INTEGRATION || 'WHATSAPP-BAILEYS',
    ownerNumber: process.env.BOOT_NUMBER,
    webhookSecret: evolutionWebhookSecret
});

commandHandler.setClient(client);
startHttpServer();
attachClientHandlers();

async function init() {
    try {
        await connectDatabase();
    } catch (e) {
        const msg = (e && typeof e === 'object' && 'message' in e) ? e.message : String(e);
        console.error(`❌ ${msg}`);
        return;
    }

    statsCounter = new StatsCounter({
        flushIntervalMs: Number(process.env.STATS_FLUSH_INTERVAL_MS) || undefined,
        maxBuffer: Number(process.env.STATS_MAX_BUFFER) || undefined
    });

    try {
        model = await nsfw.load('file://./models/inception_v3/', { type: 'inception_v3', size: 299 });
        imageAnalyzer = new ImageAnalyzer(model, {
            auditLogger,
            evidenceDir: process.env.NSFW_EVIDENCE_DIR,
            inputSize: 299
        });
        console.log('✅ Modelo de IA carregado e pronto!');
    } catch (e) {
        console.error('❌ Erro ao carregar o modelo de IA:', e);
    }

    try {
        await client.ensureInstance(evolutionWebhookUrl);
        await syncBotId();
        await client.ensureConnected({ qrCooldownMs: 0 });
        startConnectionPolling();
        console.log(`🔗 Evolution API configurada para a instância "${client.instanceName}".`);
    } catch (err) {
        console.error('❌ Falha ao inicializar a Evolution API:', err?.message || err);
    }
}

function attachClientHandlers() {
    client.on('qr', (qr) => {
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', async () => {
        isClientReady = true;
        console.log('🚀 Monitor de grupos ATIVADO via Evolution API!');
        if (isDev && devGroupId) {
            console.log(`🔧 Modo desenvolvimento: apenas o grupo ${devGroupId} será processado.`);
        }
        await syncBotId();
    });

    client.on('disconnected', (state) => {
        isClientReady = false;
        console.warn(`⚠️ Instância desconectada (${state || 'estado desconhecido'}).`);
    });

    client.on('warn', (err) => {
        console.warn('⚠️ Aviso da Evolution API:', err?.message || err);
    });

    client.on('message', async (msg) => {
        if (msg?.fromMe) {
            if (debugEvolution) console.log('[bot message] ignored=fromMe');
            return;
        }

        if (typeof msg.from === 'string' && msg.from.endsWith('@newsletter')) {
            if (debugEvolution) console.log(`[bot message] ignored=newsletter chat=${msg.from}`);
            return;
        }

        let chat;
        try {
            chat = await msg.getChat();
        } catch (e) {
            console.error('Erro ao obter chat da mensagem:', e);
            return;
        }

        if (!chat?.isGroup) {
            if (debugEvolution) console.log(`[bot message] ignored=not_group chat=${msg.from || ''}`);
            return;
        }

        const chatId = chat?.id?._serialized || chat?.id?.user || '';
        if (isDev && devGroupId) {
            if (chatId !== devGroupId) {
                if (debugEvolution) console.log(`[bot message] ignored=dev_group_mismatch chat=${chatId} expected=${devGroupId}`);
                return;
            }
        } else if (devGroupId && chatId === devGroupId) {
            if (debugEvolution) console.log(`[bot message] ignored=dev_group_in_production chat=${chatId}`);
            return;
        }

        const body = String(msg.body || '');
        const isCommand = body.trim().startsWith('/');
        const authorId = getSenderId(msg);
        if (debugEvolution) {
            console.log(`[bot message] processing chat=${chatId} author=${authorId || ''} type=${msg.type || ''} command=${isCommand} body="${body.slice(0, 80)}"`);
        }
        let authorPhone = msg._authorPhone || null;
        if (!authorPhone) {
            try {
                const contact = await msg.getContact();
                authorPhone = contact?.number || null;
            } catch (_) {
                authorPhone = null;
            }
        }
        statsCounter?.trackMessage({
            chatId,
            authorId,
            phone: authorPhone,
            isCommand
        });

        try {
            // await messageFilter.handle(msg, chat);
            await imageAnalyzer?.handle(msg, chat);
            await commandHandler.handle(msg, chat);
            await llamaResponder.handleMessage(msg, chat);
        } catch (err) {
            console.error('Erro ao processar mensagem:', err?.message || err);
        }
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
        if (isDev && devGroupId) {
            if (chatId !== devGroupId) return;
        } else if (devGroupId && chatId === devGroupId) {
            return;
        }

        await handleGroupJoin(notification, chat, { auditLogger });
    });
}

async function syncBotId() {
    const myNumber = (process.env.BOOT_NUMBER || '').trim();
    if (!myNumber) {
        console.warn('⚠️ BOOT_NUMBER não definido. Ignorando setBotId.');
        return;
    }

    const numberId = await client.getNumberId(myNumber);
    if (numberId?._serialized) {
        client.info.wid._serialized = numberId._serialized;
        llamaResponder.setBotId(numberId._serialized);
    } else {
        console.warn('⚠️ Não foi possível resolver o BOOT_NUMBER.');
    }
}

function startConnectionPolling() {
    setInterval(async () => {
        try {
            const { state } = await client.ensureConnected();
            isClientReady = state === 'open';
        } catch (err) {
            console.warn('Falha ao consultar estado da instância:', err?.message || err);
        }
    }, evolutionStatePollMs);
}

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

function isAuthorizedEvolutionWebhook(req) {
    if (!evolutionWebhookSecret) return true;
    return req.get('x-evolution-secret') === evolutionWebhookSecret;
}

function logEvolutionWebhook(req, status) {
    const event = req.body?.event || 'sem_evento';
    const instance = req.body?.instance || req.body?.data?.instance || req.body?.data?.instanceName || 'sem_instancia';
    const hasSecret = Boolean(req.get('x-evolution-secret'));
    console.log(`[Evolution webhook] ${status} event=${event} instance=${instance} hasSecret=${hasSecret}`);
}

function startHttpServer() {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ strict: true, limit: '15mb', type: 'application/json' }));

    app.post('/evolution/webhook', async (req, res) => {
        if (!isAuthorizedEvolutionWebhook(req)) {
            logEvolutionWebhook(req, 'unauthorized');
            return res.status(401).json({ error: 'unauthorized' });
        }

        try {
            logEvolutionWebhook(req, 'received');
            await client.handleWebhook(req.body);
            return res.status(200).json({ ok: true });
        } catch (err) {
            console.error('Erro ao processar webhook da Evolution:', err);
            return res.status(500).json({ error: 'webhook_failed' });
        }
    });

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
            const msg = 'Esta é uma mensagem teste enviada pela API: ' + req.body.message.trim();
            await client.sendMessage(ingestGroupId, msg);
            return res.status(202).json({ ok: true });
        } catch (e) {
            console.error('Erro ao enviar mensagem da API HTTP:', e);
            return res.status(500).json({ error: 'send_failed' });
        }
    });

    app.use((_err, _req, res, _next) => respondAsClosedPort(res));
    app.use((_req, res) => respondAsClosedPort(res));

    app.listen(ingestPort, () => {
        console.log(`🌐 API HTTP ativa na porta ${ingestPort}`);
        console.log(`🪝 Webhook Evolution esperado em ${evolutionWebhookUrl}`);
    });
}

init();
