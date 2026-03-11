const { getSenderId } = require('./messageUtils');

class CommandHandler {
    constructor(auditLogger) {
        this.auditLogger = auditLogger;
    }

    async handle(msg, chat) {
        if (!msg.body.startsWith('/ban')) return;

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
}

module.exports = CommandHandler;
