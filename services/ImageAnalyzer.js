const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const path = require('node:path');

// Motor puro de análise: recebe bytes, devolve veredito. Sem WhatsApp, sem banco.
// Quem orquestra é o worker (services/analyzer/worker.js), que roda em outro
// processo justamente porque `model.classify` bloqueia o event loop de quem chama.
class ImageAnalyzer {
    constructor(model, options = {}) {
        this.model = model;
        this.blockedClasses = options.blockedClasses ?? ['Porn', 'Hentai', 'Sexy'];
        this.inputSize = options.inputSize || this.getModelInputSize(model) || 299;
        this.laionClient = options.laionClient || null;
        this.laionThreshold = options.laionThreshold ?? Number(process.env.LAION_THRESHOLD ?? 0.5);
        // Acima do hard: bloqueia direto. Entre soft e hard: segunda opinião do LAION.
        this.hardThreshold = options.hardThreshold ?? 0.95;
        this.softThreshold = options.softThreshold ?? 0.65;
        this.isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';
    }

    /**
     * @param {Buffer} buffer bytes originais da mídia
     * @param {{mimetype?: string, isSticker?: boolean, filePath?: string}} context
     * @returns {Promise<{isNsfw: boolean|null, reason: string, predictions: Array, nsfwScore: number, laionScore: number|null, laionError: string|null, skipped: boolean}>}
     */
    async analyze(buffer, context = {}) {
        if (!this.model) throw new Error('Modelo NSFW não carregado');

        const mime = (context.mimetype || '').toLowerCase();
        const isAnimated = mime.includes('gif') || mime.includes('webp') || !!context.isSticker;
        const inputSize = this.getModelInputSize(this.model) || this.inputSize;

        const frameBuffers = await this.extractFrameBuffers(buffer, {
            inputSize,
            isAnimated,
            mime,
            filePath: context.filePath
        });

        if (!frameBuffers.length) {
            return this.result({ isNsfw: null, reason: 'UNSUPPORTED_FORMAT', skipped: true });
        }

        const predictions = await this.classifyFrames(frameBuffers);

        if (this.isDev) {
            console.log('Resultado da análise NSFWJS:', predictions);
        }

        const pornScore = getScore(predictions, 'Porn');
        const sexyScore = getScore(predictions, 'Sexy');
        const hentaiScore = getScore(predictions, 'Hentai');
        const nsfwScore = Math.max(pornScore, sexyScore, hentaiScore);

        if (nsfwScore >= this.hardThreshold) {
            return this.result({ isNsfw: true, reason: 'NSFWJS', predictions, nsfwScore });
        }

        if (nsfwScore >= this.softThreshold) {
            let laionScore;
            try {
                laionScore = await this.getLaionScore(buffer, context.filePath);
            } catch (err) {
                // Sem segunda opinião não dá para decidir: não cacheia, não apaga.
                // O worker trata como falha retentável.
                return this.result({
                    isNsfw: null,
                    reason: 'LAION_ERROR',
                    predictions,
                    nsfwScore,
                    laionError: err?.message || String(err)
                });
            }

            if (this.isDev) console.log('LAION score:', laionScore);
            predictions.push({ className: 'LAION', probability: laionScore });

            return this.result({
                isNsfw: laionScore >= this.laionThreshold,
                reason: laionScore >= this.laionThreshold ? 'LAION' : 'LAION_PASS',
                predictions,
                nsfwScore,
                laionScore
            });
        }

        return this.result({ isNsfw: false, reason: 'NSFWJS_PASS', predictions, nsfwScore });
    }

    result({ isNsfw, reason, predictions = [], nsfwScore = 0, laionScore = null, laionError = null, skipped = false }) {
        return { isNsfw, reason, predictions, nsfwScore, laionScore, laionError, skipped };
    }

    async classifyFrames(frameBuffers) {
        let predictions = [];

        for (const frameBuffer of frameBuffers) {
            const imageTensor = tf.node.decodeImage(frameBuffer, 3);
            let framePredictions;
            try {
                framePredictions = await this.model.classify(imageTensor);
            } finally {
                // O dispose precisa acontecer mesmo se o classify rejeitar: memória
                // nativa do TF não é coletada pelo GC do V8.
                imageTensor.dispose();
            }

            if (!predictions.length) {
                predictions = framePredictions;
                continue;
            }

            // keep max probability per class across frames
            const byClass = new Map(predictions.map((p) => [p.className, p.probability]));
            for (const p of framePredictions) {
                const prev = byClass.get(p.className) ?? 0;
                if (p.probability > prev) byClass.set(p.className, p.probability);
            }
            predictions = Array.from(byClass.entries()).map(([className, probability]) => ({
                className,
                probability
            }));
        }

        return predictions;
    }

    async extractFrameBuffers(bufferOriginal, context = {}) {
        const { inputSize, isAnimated, mime, filePath } = context;
        let metadata;

        try {
            metadata = await sharp(bufferOriginal, { animated: isAnimated }).metadata();
        } catch (err) {
            if (this.isUnsupportedImageError(err)) {
                console.warn('Mídia ignorada: formato não suportado pelo sharp.', {
                    filePath: filePath || null,
                    mimetype: mime || null,
                    error: err?.message || String(err)
                });
                return [];
            }
            throw err;
        }

        const frameBuffers = [];
        if (isAnimated) {
            const frameCount = metadata?.pages || 1;
            const lastIndex = Math.max(0, frameCount - 1);

            const firstFrame = await sharp(bufferOriginal, { animated: true, page: 0 })
                .toFormat('png')
                .resize(inputSize, inputSize, { fit: 'fill' })
                .toBuffer();
            frameBuffers.push(firstFrame);

            if (lastIndex !== 0) {
                const lastFrame = await sharp(bufferOriginal, { animated: true, page: lastIndex })
                    .toFormat('png')
                    .resize(inputSize, inputSize, { fit: 'fill' })
                    .toBuffer();
                frameBuffers.push(lastFrame);
            }
            return frameBuffers;
        }

        const bufferProcessado = await sharp(bufferOriginal)
            .toFormat('png')
            .resize(inputSize, inputSize, { fit: 'fill' })
            .toBuffer();
        frameBuffers.push(bufferProcessado);

        return frameBuffers;
    }

    isUnsupportedImageError(err) {
        const message = String(err?.message || err || '').toLowerCase();
        return message.includes('unsupported image format');
    }

    getModelInputSize(model) {
        const shape =
            model?.model?.inputs?.[0]?.shape ||
            model?.model?.inputShape ||
            model?.inputShape;
        const size = Array.isArray(shape) ? shape[1] : null;
        return Number.isFinite(size) ? size : null;
    }

    async getLaionScore(bufferOriginal, filePath) {
        if (!this.laionClient) throw new Error('LAION não configurado');

        // O worker já tem o arquivo em disco (spool): evita reescrever os bytes.
        if (filePath) return this.laionClient.score(filePath);

        const tmpPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.png`);
        await fs.writeFile(tmpPath, bufferOriginal);
        try {
            return await this.laionClient.score(tmpPath);
        } finally {
            try {
                await fs.unlink(tmpPath);
            } catch (_) {}
        }
    }
}

function getScore(predictions, className) {
    const found = predictions.find((p) => p.className === className);
    return found ? found.probability : 0;
}

module.exports = ImageAnalyzer;
module.exports.getScore = getScore;
