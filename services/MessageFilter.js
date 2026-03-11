const { getSenderId } = require('./messageUtils');

class MessageFilter {
    constructor(blockedWords = [], auditLogger) {
        this.blockedWords = blockedWords.map((word) => word.toLowerCase());
        this.auditLogger = auditLogger;
    }

    async handle(msg, chat) {
        const body = (msg.body || '').toLowerCase();
        const hasBlockedWord = this.blockedWords.some((word) => body.includes(word));

        if (hasBlockedWord) {
            await msg.delete(true).catch(() => {
                console.log('Erro ao deletar texto');
            });

            const authorId = getSenderId(msg);
            await this.auditLogger?.log('MESSAGE_FILTERED', {
                chatId: chat?.id?._serialized,
                phone: authorId,
                authorId,
                messageId: msg.id?._serialized || msg.id?.id,
                content: msg.body
            });
        }
    }
}

module.exports = MessageFilter;
