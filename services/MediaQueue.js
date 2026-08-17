const fs = require('node:fs/promises');
const path = require('node:path');
const { prisma } = require('./database');

// Acesso à tabela media_analysis_jobs. Usado pelos dois processos: o bot só
// enfileira e lê vereditos; o worker faz claim, analisa e escreve o resultado.
// Manter o SQL num arquivo só evita que os dois lados divirjam sobre os estados.

const STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    DONE: 'done',
    FAILED: 'failed'
};

function getSpoolDir() {
    return process.env.MEDIA_SPOOL_DIR || './storage/spool';
}

function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function writeSpoolFile(buffer, md5, extension) {
    const spoolDir = path.resolve(getSpoolDir());
    await fs.mkdir(spoolDir, { recursive: true });
    const filePath = path.join(spoolDir, `${md5}.${extension || 'bin'}`);
    await fs.writeFile(filePath, buffer);
    return filePath;
}

async function removeSpoolFile(filePath) {
    if (!filePath) return;
    try {
        await fs.unlink(filePath);
    } catch (_) {}
}

// O arquivo de spool tem o md5 no nome, então jobs de mensagens diferentes com a
// mesma imagem compartilham o mesmo arquivo. Só pode ser apagado quando nenhum
// outro job ainda precisa dele — senão o primeiro a terminar cega os demais.
async function releaseSpoolFile(job) {
    if (!job?.filePath) return;

    const stillNeeded = await prisma.mediaAnalysisJob.count({
        where: {
            md5: job.md5,
            filePath: job.filePath,
            id: { not: job.id },
            status: { in: [STATUS.PENDING, STATUS.PROCESSING] }
        }
    });
    if (stillNeeded) return;

    await removeSpoolFile(job.filePath);
}

// Veredito já decidido para este md5 em outro job: reaproveita a evidência em
// vez de regravar o mesmo arquivo.
async function findResolvedByMd5(md5, excludeId) {
    return prisma.mediaAnalysisJob.findFirst({
        where: {
            md5,
            status: STATUS.DONE,
            ...(excludeId ? { id: { not: excludeId } } : {})
        },
        orderBy: { createdAt: 'asc' },
        select: { evidencePath: true, predictions: true }
    });
}

// Idempotente por messageId: reprocessar a mesma mensagem (restart no meio do
// pipeline) não cria job duplicado.
async function enqueue(job) {
    return prisma.mediaAnalysisJob.upsert({
        where: { messageId: job.messageId },
        create: {
            messageId: job.messageId,
            md5: job.md5,
            fileHash: job.fileHash || null,
            filePath: job.filePath,
            mimetype: job.mimetype || null,
            chatId: job.chatId,
            authorId: job.authorId || null,
            phone: job.phone || null,
            caption: job.caption || null,
            status: STATUS.PENDING
        },
        update: {}
    });
}

// Devolve para a fila os jobs que ficaram presos em `processing` (worker morto
// no meio). Acima de maxAttempts vira `failed` para não girar em looping.
async function recoverStaleLocks({ lockTimeoutMs, maxAttempts }) {
    const cutoff = new Date(Date.now() - lockTimeoutMs);

    const stale = await prisma.mediaAnalysisJob.findMany({
        where: { status: STATUS.PROCESSING, lockedAt: { lt: cutoff } },
        select: { id: true, attempts: true, filePath: true }
    });
    if (!stale.length) return 0;

    for (const job of stale) {
        const exhausted = job.attempts >= maxAttempts;
        await prisma.mediaAnalysisJob.update({
            where: { id: job.id },
            data: exhausted
                ? { status: STATUS.FAILED, lockedAt: null, error: 'tentativas esgotadas após lock órfão' }
                : { status: STATUS.PENDING, lockedAt: null }
        });
        if (exhausted) await releaseSpoolFile(job);
    }

    return stale.length;
}

async function claimNext() {
    const candidate = await prisma.mediaAnalysisJob.findFirst({
        where: { status: STATUS.PENDING },
        orderBy: { createdAt: 'asc' }
    });
    if (!candidate) return null;

    // Condicional no status: mesmo com um worker só, protege contra corrida com
    // o recoverStaleLocks e contra alguém subir um segundo worker sem querer.
    const claimed = await prisma.mediaAnalysisJob.updateMany({
        where: { id: candidate.id, status: STATUS.PENDING },
        data: {
            status: STATUS.PROCESSING,
            lockedAt: new Date(),
            attempts: { increment: 1 }
        }
    });
    if (!claimed.count) return null;

    return prisma.mediaAnalysisJob.findUnique({ where: { id: candidate.id } });
}

async function completeJob(id, { isNsfw, predictions, evidencePath }) {
    return prisma.mediaAnalysisJob.update({
        where: { id },
        data: {
            status: STATUS.DONE,
            isNsfw: !!isNsfw,
            predictions: predictions ? JSON.stringify(predictions) : null,
            evidencePath: evidencePath || null,
            lockedAt: null,
            error: null,
            // Sem nada a fazer no bot quando a imagem é limpa: já entrega resolvido.
            deliveredAt: isNsfw ? null : new Date()
        }
    });
}

async function failJob(id, message, { retryable, maxAttempts }) {
    const job = await prisma.mediaAnalysisJob.findUnique({ where: { id } });
    if (!job) return null;

    const giveUp = !retryable || job.attempts >= maxAttempts;
    const updated = await prisma.mediaAnalysisJob.update({
        where: { id },
        data: {
            status: giveUp ? STATUS.FAILED : STATUS.PENDING,
            lockedAt: null,
            error: String(message || '').slice(0, 2000)
        }
    });
    if (giveUp) await releaseSpoolFile(job);
    return updated;
}

async function pendingVerdicts(limit = 20) {
    return prisma.mediaAnalysisJob.findMany({
        where: { status: STATUS.DONE, isNsfw: true, deliveredAt: null },
        orderBy: { createdAt: 'asc' },
        take: limit
    });
}

async function markDelivered(id, error) {
    return prisma.mediaAnalysisJob.update({
        where: { id },
        data: {
            deliveredAt: new Date(),
            ...(error ? { error: String(error).slice(0, 2000) } : {})
        }
    });
}

async function findMediaHash(md5) {
    return prisma.mediaHash.findUnique({ where: { md5 } });
}

// Consulta pelo hash do protocolo do WhatsApp, disponível ANTES do download.
// Um acerto aqui poupa o download inteiro — que é a parte cara do lado do bot,
// porque passa base64 pela ponte CDP.
async function findMediaHashByFileHash(fileHash) {
    if (!fileHash) return null;
    return prisma.mediaHash.findUnique({ where: { fileHash } });
}

// Job ainda na fila com o mesmo arquivo: a mídia já está no spool, então a nova
// mensagem entra na fila sem baixar nada. É o caso do flood — a mesma figurinha
// repetida por várias pessoas em segundos.
async function findActiveJobByFileHash(fileHash) {
    if (!fileHash) return null;
    return prisma.mediaAnalysisJob.findFirst({
        where: { fileHash, status: { in: [STATUS.PENDING, STATUS.PROCESSING] } },
        orderBy: { createdAt: 'asc' },
        select: { md5: true, filePath: true, mimetype: true }
    });
}

async function recordMediaHash(md5, isNsfw, fileHash) {
    try {
        await prisma.mediaHash.upsert({
            where: { md5 },
            create: { md5, isNsfw, fileHash: fileHash || null },
            update: {
                isNsfw: isNsfw ? true : undefined,
                // Preenche o fileHash de linhas antigas sem sobrescrever o que já existe.
                ...(fileHash ? { fileHash } : {})
            }
        });
    } catch (err) {
        // O fileHash é único: uma corrida entre dois md5 apontando para o mesmo
        // fileHash pode colidir. O veredito por md5 é o que importa, então grava
        // sem ele em vez de perder o cache inteiro.
        if (fileHash) {
            try {
                await prisma.mediaHash.upsert({
                    where: { md5 },
                    create: { md5, isNsfw },
                    update: { isNsfw: isNsfw ? true : undefined }
                });
                return;
            } catch (_) {}
        }
        console.warn('Falha ao salvar media hash:', err?.message || err);
    }
}

module.exports = {
    STATUS,
    getSpoolDir,
    toPositiveInt,
    writeSpoolFile,
    removeSpoolFile,
    releaseSpoolFile,
    findResolvedByMd5,
    enqueue,
    recoverStaleLocks,
    claimNext,
    completeJob,
    failJob,
    pendingVerdicts,
    markDelivered,
    findMediaHash,
    findMediaHashByFileHash,
    findActiveJobByFileHash,
    recordMediaHash
};
