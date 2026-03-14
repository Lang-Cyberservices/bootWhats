require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const nsfw = require('nsfwjs');
const MessageFilter = require('./services/MessageFilter');
const ImageAnalyzer = require('./services/ImageAnalyzer');
const CommandHandler = require('./services/CommandHandler');
const AuditLogger = require('./services/AuditLogger');
const OracleService = require('./services/OracleService');
const { connectDatabase } = require('./services/database');

let model;
let imageAnalyzer;
const auditLogger = new AuditLogger();
const oracleService = new OracleService(auditLogger);

const messageFilter = new MessageFilter(['ofensa1', 'spamlink'], auditLogger);
const commandHandler = new CommandHandler(auditLogger, oracleService);




// Função para carregar o modelo de forma assíncrona antes de tudo
async function init() {
    try {
        await connectDatabase();
    } catch (e) {
        console.error("❌ Erro ao conectar no banco de dados:", e);
        // Mesmo sem banco, não inicializamos o bot, pois ele depende fortemente do Prisma.
        return;
    }

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
    client.initialize();
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    console.log('🚀 Monitor de grupos ATIVADO!');
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

    // await messageFilter.handle(msg, chat);
    await imageAnalyzer?.handle(msg, chat);
    await commandHandler.handle(msg, chat);
});

init(); // Inicia o carregamento da IA e depois o bot
