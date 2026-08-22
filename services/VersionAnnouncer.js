const { prisma } = require('./database');

class VersionAnnouncer {
    constructor(auditLogger) {
        this.auditLogger = auditLogger;
        this.client = null;
    }

    setClient(client) {
        this.client = client;
    }

    async announcePending({ isDev, devGroupId }) {
        if (!this.client) return;

        const pending = await prisma.versionAnnouncement.findMany({
            where: { sent: false },
            orderBy: { id: 'asc' }
        });

        for (const announcement of pending) {
            await this._send(announcement, { isDev, devGroupId });
        }
    }

    async _send(announcement, { isDev, devGroupId }) {
        const text = `🆕 *Nova versão: ${announcement.version}*\n\n${announcement.notes}`;
        let targets = [];

        if (isDev && devGroupId) {
            targets = [devGroupId];
        } else {
            try {
                const chats = await this.client.getChats();
                targets = chats
                    .filter(c => c.isGroup && c.id?._serialized !== devGroupId)
                    .map(c => c.id._serialized);
            } catch (err) {
                console.error('Erro ao listar grupos para aviso de versão:', err.message);
            }
        }

        let failures = 0;
        for (const chatId of targets) {
            try {
                await this.client.sendMessage(chatId, text);
            } catch (err) {
                failures++;
                console.warn(`Falha ao enviar aviso de versão para ${chatId}:`, err.message);
            }
        }

        // Best-effort: marca como enviado mesmo com falhas pontuais, para não
        // reenviar para todos os grupos de novo por causa de 1 grupo com problema.
        await prisma.versionAnnouncement.update({
            where: { id: announcement.id },
            data: { sent: true, sentAt: new Date() }
        });

        await this.auditLogger?.log?.('VERSION_ANNOUNCEMENT_SENT', {
            content: announcement.notes,
            details: { version: announcement.version, groupCount: targets.length, failures, isDev }
        });
    }
}

module.exports = VersionAnnouncer;
