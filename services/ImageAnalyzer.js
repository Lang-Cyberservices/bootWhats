const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { getSenderId } = require('./messageUtils');
const { saveEvidence } = require('./mediaUtils');
const { prisma } = require('./database');


class ImageAnalyzer {
    constructor(model, options = {}) {
        this.model = model;
        this.threshold = options.threshold ?? 0.6;
        this.blockedClasses = options.blockedClasses ?? ['Porn', 'Hentai', 'Sexy'];
        this.auditLogger = options.auditLogger;
        this.evidenceDir = options.evidenceDir || './storage/deleted-media';
        this.inputSize = options.inputSize || this.getModelInputSize(model) || 299;
        this.laionPython = options.laionPython || process.env.LAION_PYTHON || 'python3';
        this.laionScript = options.laionScript || process.env.LAION_SCRIPT || 'tools/laion_score.py';
        this.laionThreshold = Number(process.env.LAION_THRESHOLD ?? 0.5);
        this.isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';
    }

           

    async handle(msg, chat) {
        if (!this.model) return;
        if (!msg.hasMedia || (msg.type !== 'image' && msg.type !== 'sticker')) return;

        if (this.isDev) {
            console.log(`Analisando mídia de: ${msg.author}...`);
        }

        try {
            let media;
            try {
                media = await msg.downloadMedia();
            } catch (err) {
                console.warn('Falha ao baixar mídia:', err?.message || err);
                return;
            }
            if (!media) return;

            const bufferOriginal = Buffer.from(media.data, 'base64');
            const mime = (media.mimetype || '').toLowerCase();
            const md5 = crypto.createHash('md5').update(bufferOriginal).digest('hex');
            const cached = await prisma.mediaHash.findUnique({ where: { md5 } });
            if (cached) {
                if (cached.isNsfw) {
                    await this.handleNsfw(msg, chat, media, bufferOriginal, [{ className: 'Cached', probability: 1 }]);
                }
                return;
            }
            const inputSize = this.getModelInputSize(this.model) || this.inputSize;
            const isAnimated = mime.includes('gif') || mime.includes('webp') || msg.type === 'sticker';

            const frameBuffers = [];
            if (isAnimated) {
                const frameCount = await sharp(bufferOriginal, { animated: true }).metadata()
                    .then((m) => m.pages || 1)
                    .catch(() => 1);
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
            } else {
                const bufferProcessado = await sharp(bufferOriginal)
                    .toFormat('png')
                    .resize(inputSize, inputSize, { fit: 'fill' })
                    .toBuffer();
                frameBuffers.push(bufferProcessado);
            }

            let predictions = [];
            for (const frameBuffer of frameBuffers) {
                const imageTensor = tf.node.decodeImage(frameBuffer, 3);
                const framePredictions = await this.model.classify(imageTensor);
                imageTensor.dispose();
                if (!predictions.length) {
                    predictions = framePredictions;
                } else {
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
            }

        if (this.isDev) {
            console.log('Resultado da análise NSFWJS:', predictions);
        }

            const getScore = (className) => {
                const found = predictions.find((p) => p.className === className);
                return found ? found.probability : 0;
            };

            let pornScore = getScore('Porn');
            const neutralScore = getScore('Neutral');
            const sexyScore = getScore('Sexy');
            const hentaiScore = getScore('Hentai');

            const nsfwScore = Math.max(pornScore, sexyScore, hentaiScore);

            if (nsfwScore >= 0.98) {
                await this.handleNsfw(msg, chat, media, bufferOriginal, predictions);
                await this.recordStickerHash(md5, true);
                return;
            }

            if (nsfwScore >= 0.60 && nsfwScore < 0.95) {
                const laionScore = await this.getLaionScore(bufferOriginal);
                if (this.isDev) {
                    console.log('LAION score:', laionScore);
                }
                predictions.push({
                    className: 'LAION',
                    probability: laionScore
                });
                if (laionScore >= this.laionThreshold) {
                    await this.handleNsfw(msg, chat, media, bufferOriginal, predictions);
                    await this.recordStickerHash(md5, true);
                } else {
                    await this.recordStickerHash(md5, false);
                }
                return;
            }

            await this.recordStickerHash(md5, false);
        } catch (err) {
            console.error('Erro no processamento da imagem:', err);
        }
    }

    getModelInputSize(model) {
        const shape =
            model?.model?.inputs?.[0]?.shape ||
            model?.model?.inputShape ||
            model?.inputShape;
        const size = Array.isArray(shape) ? shape[1] : null;
        return Number.isFinite(size) ? size : null;
    }

    async handleNsfw(msg, chat, media, bufferOriginal, predictions) {
        const evidencePath = await saveEvidence(bufferOriginal, {
            messageId: msg.id?._serialized || msg.id?.id,
            mimetype: media?.mimetype,
            evidenceDir: this.evidenceDir
        });
        await msg.delete(true);
        await chat.sendMessage(
            `⚠️ @${msg.author.split('@')[0]}, conteúdo impróprio não é permitido neste grupo.`,
            { mentions: [msg.author] }
        );

        const author = await msg.getContact();
        const authorPhone = author.number;
        const authorId = getSenderId(msg);

        try{
            await this.auditLogger?.log('IMAGE_REMOVED', {
                chatId: chat?.id?._serialized,
                phone: authorPhone,
                authorId,
                messageId: msg.id?._serialized || msg.id?.id,
                content: msg.caption || null,
                details: {
                    evidencePath,
                    predictions
                }
            });
        } catch (err) {
            console.warn('Falha ao salvar sticker hash:', err?.message || err);
        }
        
    }

    async getLaionScore(bufferOriginal) {
        const execFileAsync = promisify(execFile);
        const tmpName = `${crypto.randomUUID()}.png`;
        const tmpPath = path.join(os.tmpdir(), tmpName);

        await fs.writeFile(tmpPath, bufferOriginal);
        try {
            const scriptPath = await this.resolveLaionScriptPath();
            const { stdout, stderr } = await execFileAsync(
                this.laionPython,
                [scriptPath, '--image', tmpPath, '--device', 'cpu'],
                { timeout: 120000 }
            );

            const parsed = JSON.parse(stdout.trim());
            const score = Number(parsed?.score);
            if (Number.isNaN(score)) {
                throw new Error('LAION score inválido');
            }
            return score;
        }  finally {
            try {
                await fs.unlink(tmpPath);
            } catch (_) {}
        }
    }

    async resolveLaionScriptPath() {
        const candidate = this.laionScript;
        const absCandidate = path.isAbsolute(candidate)
            ? candidate
            : path.resolve(process.cwd(), candidate);
        try {
            const stat = await fs.stat(absCandidate);
            if (stat.isDirectory()) {
                return path.join(absCandidate, 'laion_score.py');
            }
        } catch (_) {}
        return absCandidate;
    }

    async recordStickerHash(md5, isNsfw) {
        try {
            await prisma.mediaHash.upsert({
                where: { md5 },
                create: { md5, isNsfw },
                update: { isNsfw: isNsfw ? true : undefined }
            });
        } catch (err) {
            console.warn('Falha ao salvar sticker hash:', err?.message || err);
        }
    }

}

module.exports = ImageAnalyzer;
