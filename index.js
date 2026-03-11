require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const nsfw = require('nsfwjs');
const MessageFilter = require('./services/MessageFilter');
const ImageAnalyzer = require('./services/ImageAnalyzer');
const CommandHandler = require('./services/CommandHandler');
const AuditLogger = require('./services/AuditLogger');
const { connectDatabase } = require('./services/database');

let model;
let imageAnalyzer;
const auditLogger = new AuditLogger();

const messageFilter = new MessageFilter(['ofensa1', 'spamlink'], auditLogger);
const commandHandler = new CommandHandler(auditLogger);

// Função para carregar o modelo de forma assíncrona antes de tudo
async function init() {
    try {
        await connectDatabase();
        model = await nsfw.load();
        imageAnalyzer = new ImageAnalyzer(model, {
            auditLogger,
            evidenceDir: process.env.NSFW_EVIDENCE_DIR
        });
        console.log("✅ Modelo de IA carregado e pronto!");
        client.initialize();
    } catch (e) {
        console.error("❌ Erro ao carregar o modelo de IA:", e);
    }
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
    const chat = await msg.getChat();

    if (!chat.isGroup) return;

    await messageFilter.handle(msg, chat);
    await imageAnalyzer?.handle(msg, chat);
    await commandHandler.handle(msg, chat);
});

init(); // Inicia o carregamento da IA e depois o bot
