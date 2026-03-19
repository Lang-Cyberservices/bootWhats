const { prisma } = require('./database');

function normalizeChatId(chat) {
    return chat?.id?._serialized || chat?.id?.user || '';
}

async function handleGroupJoin(notification, chat, { auditLogger } = {}) {
    const chatId = normalizeChatId(chat);
    if (!chatId) return;

    const result = await prisma.$transaction(async (tx) => {
        const cfg = await tx.welcomeConfig.findUnique({ where: { chatId } });
        if (!cfg || !cfg.enabled) {
            return { shouldSend: false };
        }

        const threshold = Number(cfg.peopleToTrigger || 0);
        if (!Number.isFinite(threshold) || threshold <= 0) {
            return { shouldSend: false };
        }

        const next = (Number(cfg.counter || 0) + 1);
        const shouldSend = next >= threshold;

        await tx.welcomeConfig.update({
            where: { chatId },
            data: {
                counter: shouldSend ? 0 : next
            }
        });

        return { shouldSend, message: cfg.message };
    });

    if (!result?.shouldSend) return;

    try {
        await chat.sendMessage(result.message);
        await auditLogger?.log?.('WELCOME_SENT', {
            chatId,
            content: result.message,
            details: {
                event: 'group_join',
                recipients: notification?.recipients || null
            }
        });
    } catch (err) {
        console.warn('Falha ao enviar mensagem de boas-vindas:', err?.message || err);
    }
}

module.exports = {
    handleGroupJoin
};

