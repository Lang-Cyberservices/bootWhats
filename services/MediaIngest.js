const crypto = require('node:crypto');
const { getSenderId } = require('./messageUtils');
const { saveEvidence, getExtension, decodeMediaBuffer } = require('./mediaUtils');
const MediaQueue = require('./MediaQueue');

// Lado do bot: baixa a mídia, calcula o md5, consulta o cache e enfileira.
// Nada de sharp/tfjs aqui — é isso que mantém o event loop livre para o
// Puppeteer responder. A análise pesada roda no processo do worker.
class MediaIngest {
    constructor(options = {}) {
        this.auditLogger = options.auditLogger;
        this.blockedCommands = options.blockedCommands;
        this.evidenceDir = options.evidenceDir || process.env.NSFW_EVIDENCE_DIR || './storage/deleted-media';
        this.isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';
        // Só é preenchido com IMAGE_ANALYSIS_MODE=inline: modo de emergência que
        // analisa dentro do processo do bot, como era antes da fila.
        this.inlineAnalyzer = options.inlineAnalyzer || null;
    }

    async handle(msg, chat) {
        if (!msg.hasMedia || (msg.type !== 'image' && msg.type !== 'sticker')) return;

        const chatId = chat?.id?._serialized || chat?.id?.user || '';
        if (this.blockedCommands?.isBlocked(chatId, 'proibir')) return;

        const messageId = msg.id?._serialized || msg.id?.id;
        if (!messageId) return;

        if (this.isDev) console.log(`Enfileirando mídia de: ${msg.author}...`);

        try {
            // Dois atalhos que dispensam o download inteiro. Só existem quando o
            // WhatsApp manda o filehash junto do metadado da mensagem.
            const fileHash = this.extractFileHash(msg);
            if (fileHash && !this.inlineAnalyzer) {
                if (await this.resolveByFileHash(msg, chat, fileHash)) return;
                if (await this.enqueueFromActiveJob(msg, chat, chatId, messageId, fileHash)) return;
            }

            let media;
            try {
                media = await msg.downloadMedia();
            } catch (err) {
                console.warn('Falha ao baixar mídia:', err?.message || err);
                return;
            }
            if (!media) return;

            const buffer = decodeMediaBuffer(media);
            if (!buffer) {
                console.warn('Mídia ignorada: payload vazio ou base64 inválido.', {
                    messageId,
                    mimetype: media?.mimetype || null,
                    type: msg.type
                });
                return;
            }

            const md5 = crypto.createHash('md5').update(buffer).digest('hex');

            // Cache hit: resolve na hora, sem passar pela fila. É o que mantém a
            // resposta imediata para reincidentes mesmo com o grupo agitado.
            const cached = await MediaQueue.findMediaHash(md5);
            if (cached) {
                if (cached.isNsfw) {
                    await this.deleteAndWarn(msg, chat, buffer, media?.mimetype, md5, [
                        { className: 'Cached', probability: 1 }
                    ]);
                }
                return;
            }

            if (this.inlineAnalyzer) {
                await this.analyzeInline(msg, chat, buffer, media?.mimetype, md5, fileHash);
                return;
            }

            const filePath = await MediaQueue.writeSpoolFile(buffer, md5, getExtension(media?.mimetype));
            await MediaQueue.enqueue({
                messageId,
                md5,
                fileHash,
                filePath,
                mimetype: media?.mimetype || null,
                chatId,
                authorId: getSenderId(msg),
                phone: msg._authorPhone || null,
                caption: msg.caption || null
            });
        } catch (err) {
            console.error('Erro ao enfileirar imagem:', err);
        }
    }

    // SHA256 do arquivo original, vindo do protocolo. Nem toda build do WhatsApp
    // Web expõe isso no modelo serializado, então tudo aqui é oportunista: sem
    // filehash o fluxo cai no caminho normal de baixar e hashear.
    extractFileHash(msg) {
        const raw = msg?.rawData?.filehash;
        return typeof raw === 'string' && raw.length >= 16 && raw.length <= 128 ? raw : null;
    }

    // Imagem já julgada em algum momento: decide sem baixar um byte.
    async resolveByFileHash(msg, chat, fileHash) {
        const known = await MediaQueue.findMediaHashByFileHash(fileHash);
        if (!known) return false;

        if (this.isDev) console.log(`Mídia reconhecida pelo filehash (sem download): ${known.isNsfw ? 'NSFW' : 'ok'}`);
        if (known.isNsfw) {
            // Sem buffer: a evidência desta imagem já foi salva quando ela foi
            // julgada pela primeira vez.
            await this.deleteAndWarn(msg, chat, null, null, known.md5, [
                { className: 'Cached', probability: 1 }
            ]);
        }
        return true;
    }

    // Imagem ainda na fila: o arquivo já está no spool, então basta apontar para ele.
    async enqueueFromActiveJob(msg, chat, chatId, messageId, fileHash) {
        const active = await MediaQueue.findActiveJobByFileHash(fileHash);
        if (!active) return false;

        if (this.isDev) console.log('Mídia já na fila (sem download): reaproveitando o spool.');
        await MediaQueue.enqueue({
            messageId,
            md5: active.md5,
            fileHash,
            filePath: active.filePath,
            mimetype: active.mimetype,
            chatId,
            authorId: getSenderId(msg),
            phone: msg._authorPhone || null,
            caption: msg.caption || null
        });
        return true;
    }

    async analyzeInline(msg, chat, buffer, mimetype, md5, fileHash) {
        const verdict = await this.inlineAnalyzer.analyze(buffer, {
            mimetype,
            isSticker: msg.type === 'sticker',
            filePath: null
        });

        if (verdict.skipped || verdict.isNsfw === null) return;

        await MediaQueue.recordMediaHash(md5, verdict.isNsfw, fileHash);
        if (verdict.isNsfw) {
            await this.deleteAndWarn(msg, chat, buffer, mimetype, md5, verdict.predictions);
        }
    }

    async deleteAndWarn(msg, chat, buffer, mimetype, md5, predictions, evidencePath = null) {
        const savedPath = evidencePath || (buffer
            ? await saveEvidence(buffer, {
                messageId: msg.id?._serialized || msg.id?.id,
                mimetype,
                evidenceDir: this.evidenceDir,
                md5
            })
            : null);

        await msg.delete(true);
        await chat.sendMessage(
            `⚠️ @${msg.author.split('@')[0]}, conteúdo impróprio não é permitido neste grupo.`,
            { mentions: [msg.author] }
        );

        let authorPhone = null;
        try {
            const author = await msg.getContact();
            authorPhone = author?.number || null;
        } catch (_) {}

        await this.auditLogger?.log('IMAGE_REMOVED', {
            chatId: chat?.id?._serialized,
            phone: authorPhone,
            authorId: getSenderId(msg),
            messageId: msg.id?._serialized || msg.id?.id,
            content: msg.caption || null,
            details: { evidencePath: savedPath, predictions }
        });
    }
}

module.exports = MediaIngest;
