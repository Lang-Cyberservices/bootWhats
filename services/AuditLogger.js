const { prisma } = require('./database');

class AuditLogger {
    async log(action, data = {}) {
        try {
            await prisma.log.create({
                data: {
                    action,
                    chatId: data.chatId || null,
                    phone: data.phone || null,
                    authorId: data.authorId || null,
                    targetId: data.targetId || null,
                    messageId: data.messageId || null,
                    content: data.content || null,
                    details: data.details ? JSON.stringify(data.details) : null
                }
            });
        } catch (err) {
            console.error(`Erro ao salvar log "${action}":`, err.message);
        }
    }
}

module.exports = AuditLogger;
