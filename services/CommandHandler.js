const { getSenderId } = require('./messageUtils');
const sharp = require('sharp');
const { MessageMedia } = require('whatsapp-web.js');
const { prisma } = require('./database');
const ytdl = require('ytdl-core');

// Controle simples de flood por usuário (em memória)
const COMMAND_WINDOW_MS = 60_000;
const DEFAULT_MAX_COMMANDS_PER_MINUTE = 3;
const MAX_COMMANDS_PER_MINUTE = (() => {
    const raw = process.env.MAX_COMMANDS_PER_MINUTE;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_COMMANDS_PER_MINUTE;
})();
const commandHistoryByUser = new Map(); // key: authorId, value: number[]

function isRateLimited(authorId) {
    if (!authorId) return false;

    const now = Date.now();
    const windowStart = now - COMMAND_WINDOW_MS;

    const history = commandHistoryByUser.get(authorId) || [];
    const recent = history.filter((ts) => ts >= windowStart);
    recent.push(now);
    commandHistoryByUser.set(authorId, recent);

    return recent.length > MAX_COMMANDS_PER_MINUTE;
}

class CommandHandler {
    constructor(auditLogger, oracleService) {
        this.auditLogger = auditLogger;
        this.oracleService = oracleService;
    }

    async handle(msg, chat) {
        const body = msg.body || '';
        if (!body.startsWith('/')) return;

        const [command, ...args] = body.trim().split(/\s+/);

        const authorId = getSenderId(msg);
        const knownCommands = ['/ban', '/oraculo', '/sobre', '/ajuda', '/sticker', '/piada', '/youtube'];
        const isKnown = knownCommands.includes(command);

        // Só aplica rate limit para comandos válidos conhecidos
        if (isKnown && isRateLimited(authorId)) {
            await msg.reply('⏱️ Até a pressa precisa de limite. Respira, espera um pouco e tenta de novo.');
            return;
        }

        if (command === '/ban') {
            return this.handleBan(msg, chat);
        }

        if (command === '/oraculo') {
            return this.handleOraculo(msg, chat);
        }

        if (command === '/sobre') {
            return this.handleSobre(msg, chat);
        }

        if (command === '/ajuda') {
            return this.handleAjuda(msg, chat);
        }

        if (command === '/sticker') {
            return this.handleSticker(msg, chat);
        }

        if (command === '/piada') {
            return this.handlePiada(msg, chat);
        }

        if (command === '/youtube') {
            return this.handleYouTube(msg, chat, args);
        }

        return await msg.reply('❌ Por que invocar um comando que nem o próprio bot reconhece? Use /ajuda e ilumine-se antes de tentar de novo.');
    }

    async handleBan(msg, chat) {
        const authorId = getSenderId(msg);
        const groupParticipants = chat.participants;
        const isAdmin = groupParticipants.some(
            (participant) =>
                participant.id._serialized === authorId &&
                (participant.isAdmin || participant.isSuperAdmin)
        );

        if (!isAdmin) {
            await msg.reply('❌ Nem todos que sonham com poder estão prontos para exercê-lo. Apenas administradores podem usar este comando.');
            return;
        }

        if (!msg.hasQuotedMsg) {
            await msg.reply('❓ Para purificar este antro da tolice, aponta tua lanterna para a face do imundo — responde à mensagem daquele que não merece o sol — e brada o decreto: /ban');
            return;
        }

        const quotedMsg = await msg.getQuotedMessage();
        const userToBan = quotedMsg.author;

        try {
            await chat.removeParticipants([userToBan]);
            await msg.reply('Finalmente, um pouco de silêncio. O estorvo foi removido e o ar parece mais limpo. Agora, saia do meu sol para que eu possa contemplar o nada em paz.');

            await this.auditLogger?.log('BAN_EXECUTED', {
                chatId: chat?.id?._serialized,
                phone: authorId,
                authorId,
                targetId: userToBan,
                messageId: msg.id?._serialized || msg.id?.id,
                content: msg.body
            });
        } catch (err) {
            console.error(err);
            await msg.reply('❌ A lanterna falhou em encontrar o caminho da saída. O estorvo permanece entre nós, como uma mancha que não sai com água. Verificai se tendes o poder para tal ato ou se o destino decidiu que ainda deveis suportar a presença deste bípede sem penas.');
        }
    }

    async handleOraculo(msg, chat) {
        if (!this.oracleService) {
            await msg.reply('❌ Queres ouvir o oráculo, mas nem acendeu o fogo do templo.');
            return;
        }

        await this.oracleService.getWeeklyPrediction(msg, chat);
    }

    async handleSobre(msg, _chat) {
        const text =
`🤖 *Sobre o bot*

Este bot foi criado para ajudar na moderação e trazer um pouco de diversão para o grupo:

Desenvolvido com carinho pela equipe *DevTeam*, www.devteam.com.br.`;

        await msg.reply(text);
    }

    async handleAjuda(msg, _chat) {
        const text =
`📖 *Lista de comandos disponíveis*

- 🔨 */ban*  
  Apenas administradores. Responda a uma mensagem com /ban para remover o usuário do grupo.

- 🔮 */oraculo*  
  Consulta o oráculo místico e retorna sua previsão da semana (uma vez por semana por usuário).

- 😂 */piada*  
  Envia uma piada aleatória do bot.

- 🖼️ */sticker*  
  Responda uma imagem/GIF com /sticker para o bot transformar em figurinha.

- ℹ️ */sobre*  
  Mostra um resumo sobre o bot e quem desenvolveu.

- ❓ */ajuda*  
  Exibe esta lista de comandos.`;

        await msg.reply(text);
    }

    async handleSticker(msg, chat) {
        if (!msg.hasQuotedMsg) {
            await msg.reply('🖼️ Para criar uma figurinha, responda uma *imagem* ou *GIF/vídeo curto* com o comando */sticker*.');
            return;
        }

        const quotedMsg = await msg.getQuotedMessage();

        if (!quotedMsg?.hasMedia) {
            await msg.reply('❌ Queres figurinha do nada, como quem pede sombra sem sol. Responda uma imagem ou GIF/vídeo curto e use */sticker*.');
            return;
        }

        try {
            const media = await quotedMsg.downloadMedia();
            if (!media) {
                await msg.reply('❌ Até a arte precisa de matéria-prima. Não consegui baixar a mídia para criar a figurinha. Tente novamente.');
                return;
            }

            let stickerMedia = media;
            const mime = (media.mimetype || '').toLowerCase();

            // Para imagens, normaliza para WEBP 512x512 (padrão de sticker)
            if (mime.startsWith('image/')) {
                const inputBuffer = Buffer.from(media.data, 'base64');
                const webpBuffer = await sharp(inputBuffer, { animated: true })
                    .resize(512, 512, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .webp({ quality: 80 })
                    .toBuffer();

                stickerMedia = new MessageMedia('image/webp', webpBuffer.toString('base64'), 'sticker.webp');
            }

            await chat.sendMessage(stickerMedia, {
                sendMediaAsSticker: true,
                stickerName: 'BootWhats',
                stickerAuthor: 'DevTeam'
            });
        } catch (err) {
            console.error('Erro ao gerar sticker:', err);
            await msg.reply('❌ Nem toda imagem nasceu para ser ícone. ');
        }
    }

    async handlePiada(msg, _chat) {
        try {
            const total = await prisma.joke.count();

            if (!total) {
                await msg.reply('😕 Numa cidade cheia de tolos, faltam-me justamente as piadas. ');
                return;
            }

            const randomIndex = Math.floor(Math.random() * total);
            const jokes = await prisma.joke.findMany({
                skip: randomIndex,
                take: 1
            });

            const joke = jokes[0];

            if (!joke) {
                await msg.reply('😕 Até o humor, às vezes, foge da praça.');
                return;
            }

            await msg.reply(`😂 *Piada do bot (#${joke.id})*\n\n${joke.text}`);
        } catch (err) {
            console.error('Erro ao buscar piada:', err);
            await msg.reply('❌ Nem sempre a graça obedece ao clique. Não consegui buscar uma piada agora, tente novamente em alguns instantes.');
        }
    }

    async handleYouTube(msg, chat, args) {
        const url = args[0];

        if (!url) {
            await msg.reply('❌ Queres um vídeo sem apontar o caminho. Envie algo como: /youtube https://youtu.be/algum_video_curto');
            return;
        }

        if (!ytdl.validateURL(url)) {
            await msg.reply('❌ Até Diógenes reconheceria um caminho torto: este não parece ser um link válido do YouTube.');
            return;
        }

        try {
            const info = await ytdl.getInfo(url);
            const durationSec = Number(info.videoDetails.lengthSeconds || 0);

            if (durationSec > 120) {
                await msg.reply('⏱️ Este vídeo é longo demais para a praça. Envie apenas vídeos curtos (até 2 minutos).');
                return;
            }

            const chunks = [];
            await new Promise((resolve, reject) => {
                ytdl(url, {
                    quality: 'lowest',
                    filter: 'audioandvideo'
                })
                    .on('data', (chunk) => chunks.push(chunk))
                    .on('end', resolve)
                    .on('error', reject);
            });

            const buffer = Buffer.concat(chunks);
            const maxBytes = 16 * 1024 * 1024; // ~16MB

            if (buffer.length > maxBytes) {
                await msg.reply('📦 O vídeo que trouxeste pesa mais do que esta ágora suporta. Tente um link mais curto ou leve.');
                return;
            }

            const filename = `${info.videoDetails.title || 'video'}.mp4`;
            const media = new MessageMedia('video/mp4', buffer.toString('base64'), filename);

            await chat.sendMessage(media, {
                sendVideoAsDocument: false
            });
        } catch (err) {
            console.error('Erro ao baixar vídeo do YouTube:', err);
            await msg.reply('❌ Até os bytes se rebelam às vezes. Não consegui trazer este vídeo do YouTube; tente outro link ou tente mais tarde.');
        }
    }
}

module.exports = CommandHandler;
