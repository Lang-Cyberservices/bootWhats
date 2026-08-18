const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');
const { rankLevel } = require('./analyzer/VisionClient');

// Motor puro de análise: recebe bytes, devolve veredito. Sem WhatsApp, sem banco.
// Quem orquestra é o worker (services/analyzer/worker.js), que roda em outro
// processo justamente porque `model.classify` bloqueia o event loop de quem chama.
class ImageAnalyzer {
    constructor(model, options = {}) {
        this.model = model;
        this.blockedClasses = options.blockedClasses ?? ['Porn', 'Hentai', 'Sexy'];
        this.inputSize = options.inputSize || this.getModelInputSize(model) || 299;
        this.visionClient = options.visionClient || null;
        // Portão: abaixo disso o NSFWJS libera sozinho. Acima, quem decide é sempre
        // o Vision — não existe bloqueio direto pelo NSFWJS.
        this.visionGate = options.visionGate ?? Number(process.env.NSFW_VISION_GATE ?? 0.3);
        this.adultLevel = options.adultLevel ?? (process.env.GOOGLE_VISION_ADULT_LEVEL || 'LIKELY');
        this.racyLevel = options.racyLevel ?? (process.env.GOOGLE_VISION_RACY_LEVEL || 'LIKELY');
        this.isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';
    }

    /**
     * @param {Buffer} buffer bytes originais da mídia
     * @param {{mimetype?: string, isSticker?: boolean, filePath?: string}} context
     * @returns {Promise<{isNsfw: boolean|null, reason: string, predictions: Array, nsfwScore: number, safeSearch: object|null, visionError: string|null, skipped: boolean}>}
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

        if (nsfwScore < this.visionGate) {
            return this.result({ isNsfw: false, reason: 'NSFWJS_PASS', predictions, nsfwScore });
        }

        let safeSearch;
        try {
            safeSearch = await this.getSafeSearch(buffer, isAnimated);
        } catch (err) {
            // Sem segunda opinião não dá para decidir: não cacheia, não apaga.
            // O worker trata como falha retentável.
            return this.result({
                isNsfw: null,
                reason: 'VISION_ERROR',
                predictions,
                nsfwScore,
                visionError: err?.message || String(err)
            });
        }

        const isNsfw =
            rankLevel(safeSearch.adult) >= rankLevel(this.adultLevel) ||
            rankLevel(safeSearch.racy) >= rankLevel(this.racyLevel);

        // Vai para media_analysis_jobs.predictions e daí para o log IMAGE_REMOVED.
        // O nível cru viaja junto porque `probability` sozinho perde o que importa
        // na hora de auditar por que a imagem caiu.
        predictions.push(
            { className: 'VISION_ADULT', probability: rankLevel(safeSearch.adult) / 5, level: safeSearch.adult },
            { className: 'VISION_RACY', probability: rankLevel(safeSearch.racy) / 5, level: safeSearch.racy }
        );

        return this.result({
            isNsfw,
            reason: isNsfw ? 'VISION' : 'VISION_PASS',
            predictions,
            nsfwScore,
            safeSearch
        });
    }

    result({ isNsfw, reason, predictions = [], nsfwScore = 0, safeSearch = null, visionError = null, skipped = false }) {
        return { isNsfw, reason, predictions, nsfwScore, safeSearch, visionError, skipped };
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

    // Os frames de extractFrameBuffers não servem aqui: saem 299x299 com
    // `fit: 'fill'`, distorcidos para o tensor. O Vision recebe a imagem original,
    // só reduzida — e sempre um frame estático, porque webp animado e gif a API
    // não trata bem.
    async getSafeSearch(bufferOriginal, isAnimated) {
        if (!this.visionClient) throw new Error('Google Vision não configurado');

        const payload = await sharp(bufferOriginal, isAnimated ? { page: 0 } : {})
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();

        return this.visionClient.safeSearch(payload);
    }
}

function getScore(predictions, className) {
    const found = predictions.find((p) => p.className === className);
    return found ? found.probability : 0;
}

module.exports = ImageAnalyzer;
module.exports.getScore = getScore;
