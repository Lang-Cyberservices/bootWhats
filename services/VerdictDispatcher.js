const MediaQueue = require('./MediaQueue');

// Aplica no WhatsApp os vereditos que o worker já decidiu. Roda no processo do
// bot porque só ele tem o cliente autenticado. O trabalho aqui é I/O puro:
// reidratar a mensagem, apagar e avisar.
class VerdictDispatcher {
    constructor(options = {}) {
        this.client = options.client;
        this.auditLogger = options.auditLogger;
        this.mediaIngest = options.mediaIngest;
        this.pollIntervalMs = MediaQueue.toPositiveInt(process.env.VERDICT_POLL_MS, 2000);
        this.batchSize = MediaQueue.toPositiveInt(process.env.VERDICT_BATCH_SIZE, 20);
        this.timer = null;
        this.running = false;
    }

    setClient(client) {
        this.client = client;
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.tick().catch((err) =>
                console.error('VerdictDispatcher: erro inesperado:', err?.message || err)
            );
        }, this.pollIntervalMs);
        this.timer.unref?.();
        console.log(`⚖️ Entregador de vereditos ativo (a cada ${this.pollIntervalMs}ms).`);
    }

    stop() {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    async tick() {
        // Um ciclo por vez: uma rodada lenta não pode empilhar com a próxima.
        if (this.running || !this.client) return;
        this.running = true;
        try {
            const jobs = await MediaQueue.pendingVerdicts(this.batchSize);
            for (const job of jobs) {
                await this.deliver(job);
            }
        } finally {
            this.running = false;
        }
    }

    async deliver(job) {
        try {
            const msg = await this.client.getMessageById(job.messageId);
            if (!msg) throw new Error('mensagem não encontrada (já apagada ou fora do cache)');

            const chat = await msg.getChat();
            let predictions = [];
            try {
                predictions = job.predictions ? JSON.parse(job.predictions) : [];
            } catch (_) {}

            await this.mediaIngest.deleteAndWarn(
                msg,
                chat,
                null,
                job.mimetype,
                job.md5,
                predictions,
                job.evidencePath
            );

            await MediaQueue.markDelivered(job.id);
        } catch (err) {
            const reason = err?.message || String(err);
            // Não engolir: mensagem fora da janela de exclusão do WhatsApp ou
            // sumida do cache é informação que o admin precisa ver.
            console.warn(`Falha ao aplicar veredito (job ${job.id}):`, reason);
            await this.auditLogger?.log('IMAGE_DELETE_FAILED', {
                chatId: job.chatId,
                phone: job.phone,
                authorId: job.authorId,
                messageId: job.messageId,
                details: { reason, md5: job.md5, evidencePath: job.evidencePath }
            });
            // Marca entregue mesmo assim: retentar não traz a mensagem de volta.
            await MediaQueue.markDelivered(job.id, reason);
        }
    }
}

module.exports = VerdictDispatcher;
