const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getSenderId } = require('./messageUtils');


class ImageAnalyzer {
    constructor(model, options = {}) {
        this.model = model;
        this.threshold = options.threshold ?? 0.6;
        this.blockedClasses = options.blockedClasses ?? ['Porn', 'Hentai', 'Sexy'];
        this.auditLogger = options.auditLogger;
        this.evidenceDir = options.evidenceDir || './storage/deleted-media';
        this.inputSize = options.inputSize || this.getModelInputSize(model) || 299;
    }

           

    async handle(msg, chat) {
        if (!this.model) return;
        if (!msg.hasMedia || (msg.type !== 'image' && msg.type !== 'sticker')) return;

        console.log(`Analisando mídia de: ${msg.author}...`);

        try {
            const media = await msg.downloadMedia();
            if (!media) return;

            const bufferOriginal = Buffer.from(media.data, 'base64');
            const inputSize = this.getModelInputSize(this.model) || this.inputSize;
            const bufferProcessado = await sharp(bufferOriginal)
                .toFormat('png')
                .resize(inputSize, inputSize, { fit: 'fill' })
                .toBuffer();

            const imageTensor = tf.node.decodeImage(bufferProcessado, 3);
            const predictions = await this.model.classify(imageTensor);
            imageTensor.dispose();

            console.log('Imagem processada e pronta para o TensorFlow!');
            console.log('Resultado da análise:', predictions);

            const getScore = (className) => {
                const found = predictions.find((p) => p.className === className);
                return found ? found.probability : 0;
            };

            let pornScore = getScore('Porn');
            const neutralScore = getScore('Neutral');
            const sexyScore = getScore('Sexy');
            const hentaiScore = getScore('Hentai');

            const isNSFW =
                pornScore > 0.85 || sexyScore > 0.80 || hentaiScore > 0.80;

            if (isNSFW) {
                const evidencePath = await this.saveEvidence(msg, media, bufferOriginal);
                await msg.delete(true);
                await chat.sendMessage(
                    `⚠️ @${msg.author.split('@')[0]}, conteúdo impróprio não é permitido neste grupo.`,
                    { mentions: [msg.author] }
                );

                const authorId = getSenderId(msg);
                await this.auditLogger?.log('IMAGE_REMOVED', {
                    chatId: chat?.id?._serialized,
                    phone: authorId,
                    authorId,
                    messageId: msg.id?._serialized || msg.id?.id,
                    content: msg.caption || null,
                    details: {
                        evidencePath,
                        predictions
                    }
                });

                console.log('🚫 Mídia removida!');
            }
        } catch (err) {
            console.error('Erro no processamento da imagem:', err);
        }
    }

    async saveEvidence(msg, media, bufferOriginal) {
        await fs.mkdir(this.evidenceDir, { recursive: true });

        const rawMessageId = msg.id?._serialized || msg.id?.id || `${Date.now()}`;
        const safeMessageId = String(rawMessageId).replace(/[^a-zA-Z0-9._-]/g, '_');
        const extension = this.getExtension(media);
        const fileName = `${Date.now()}_${safeMessageId}.${extension}`;
        const targetPath = path.resolve(this.evidenceDir, fileName);

        await fs.writeFile(targetPath, bufferOriginal);

        return targetPath;
    }

    getExtension(media) {
        if (!media?.mimetype) return 'bin';
        const [, subtype] = media.mimetype.split('/');
        if (!subtype) return 'bin';
        return subtype.split(';')[0].replace('+xml', '');
    }

    getModelInputSize(model) {
        const shape =
            model?.model?.inputs?.[0]?.shape ||
            model?.model?.inputShape ||
            model?.inputShape;
        const size = Array.isArray(shape) ? shape[1] : null;
        return Number.isFinite(size) ? size : null;
    }

   


}

module.exports = ImageAnalyzer;
