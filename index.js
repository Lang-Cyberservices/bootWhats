require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const nsfw = require('nsfwjs');
const MessageFilter = require('./services/MessageFilter');
const ImageAnalyzer = require('./services/ImageAnalyzer');
const CommandHandler = require('./services/CommandHandler');
const AuditLogger = require('./services/AuditLogger');
const OracleService = require('./services/OracleService');
const { handleGroupJoin } = require('./services/WelcomeService');
const { connectDatabase } = require('./services/database');
const StatsCounter = require('./services/StatsCounter');
const { getSenderId } = require('./services/messageUtils');
const LlamaResponder = require('./services/LlamaResponder');

const isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';
const devGroupId = (process.env.DEV_GROUP_ID || '').trim();
const webVersion = (process.env.WWEB_VERSION || '2.3000.1035465378').trim();
let seenGroupIdsInDev = null;

let model;
let imageAnalyzer;
const auditLogger = new AuditLogger();
const oracleService = new OracleService(auditLogger);

const messageFilter = new MessageFilter(['ofensa1', 'spamlink'], auditLogger);
const commandHandler = new CommandHandler(auditLogger, oracleService);
let statsCounter;
const llamaResponder = new LlamaResponder({ auditLogger });

async function startClientWithRetry(attempt = 1) {
    try {
        await client.initialize();
    } catch (err) {
        const msg = err?.message || err;
        const delayMs = Math.min(30000, 2000 * attempt);
        console.error(`❌ Falha ao inicializar o WhatsApp Web (tentativa ${attempt}).`, msg);
        console.error(`🔁 Tentando novamente em ${Math.round(delayMs / 1000)}s...`);
        setTimeout(() => {
            startClientWithRetry(attempt + 1);
        }, delayMs);
    }
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

    try {
        model = await nsfw.load('file://./models/inception_v3/', { type: 'inception_v3', size: 299 });
        imageAnalyzer = new ImageAnalyzer(model, {
            auditLogger,
            evidenceDir: process.env.NSFW_EVIDENCE_DIR,
            inputSize: 299
        });
        console.log("✅ Modelo de IA carregado e pronto!");
    } catch (e) {
        console.error("❌ Erro ao carregar o modelo de IA:", e);
    }

    // Inicializa o cliente mesmo se o modelo NSFW falhar,
    // assim o bot continua funcionando (apenas sem análise de imagem).
    await startClientWithRetry();
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
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: true
    }
});
commandHandler.setClient(client);

client.on('qr', (qr) => {
    qrcode.generate(qr, {small: true});
});

client.on('ready',  async() => {
    console.log('🚀 Monitor de grupos ATIVADO!');
    if (isDev && devGroupId) {
        console.log(`🔧 Modo desenvolvimento: apenas o grupo ${devGroupId} será processado.`);
    }
    const myNumber = (process.env.BOOT_NUMBER || '').trim();
    if (!myNumber) {
        console.warn('⚠️ BOOT_NUMBER não definido. Ignorando setBotId.');
        return;
    }
    const numberId = await client.getNumberId(myNumber);
    if (numberId?._serialized) {
        llamaResponder.setBotId(numberId._serialized);
    } else {
        console.warn('⚠️ Não foi possível resolver o BOOT_NUMBER com getNumberId.');
    }
});

client.on('message', async (msg) => {
    if (typeof msg.from === 'string' && msg.from.endsWith('@newsletter')) {
        return; // Ignora mensagens de canais para evitar bug no ChatFactory
    }



    let chat;
    try {
        chat = await msg.getChat();
    } catch (e) {
        console.error('Erro ao obter chat da mensagem:', e);
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
    await imageAnalyzer?.handle(msg, chat);
    await commandHandler.handle(msg, chat);
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

init(); // Inicia o carregamento da IA e depois o bot
