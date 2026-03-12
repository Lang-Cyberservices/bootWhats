const { getSenderId } = require('./messageUtils');
const sharp = require('sharp');
const { MessageMedia } = require('whatsapp-web.js');

class CommandHandler {
    constructor(auditLogger, oracleService) {
        this.auditLogger = auditLogger;
        this.oracleService = oracleService;
    }

    async handle(msg, chat) {
        const body = msg.body || '';
        if (!body.startsWith('/')) return;

        const [command] = body.trim().split(/\s+/);

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
            await msg.reply('❌ Erro: Apenas administradores podem usar este comando.');
            return;
        }

        if (!msg.hasQuotedMsg) {
            await msg.reply('❓ Para banir, responda à mensagem da pessoa que você quer remover com o comando /ban.');
            return;
        }

        const quotedMsg = await msg.getQuotedMessage();
        const userToBan = quotedMsg.author;

        try {
            await chat.removeParticipants([userToBan]);
            await msg.reply('🔨 O martelo do ban foi batido! Usuário removido.');

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
            await msg.reply('❌ Erve ao banir: Certifique-se de que o BOT é administrador do grupo.');
        }
    }

    async handleOraculo(msg, chat) {
        if (!this.oracleService) {
            await msg.reply('❌ Serviço de oráculo não está configurado.');
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
            await msg.reply('❌ A mensagem respondida não tem mídia. Responda uma imagem ou GIF/vídeo curto e use */sticker*.');
            return;
        }

        try {
            const media = await quotedMsg.downloadMedia();
            if (!media) {
                await msg.reply('❌ Não consegui baixar a mídia para criar a figurinha. Tente novamente.');
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
            await msg.reply('❌ Não consegui transformar em figurinha agora. Se for GIF, confirme que é um GIF/vídeo curto e tente novamente.');
        }
    }
}

module.exports = CommandHandler;
