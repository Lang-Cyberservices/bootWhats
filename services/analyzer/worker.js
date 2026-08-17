require('dotenv').config();

const fs = require('node:fs/promises');
const nsfw = require('nsfwjs');
const tf = require('@tensorflow/tfjs-node');
const { connectDatabase, prisma } = require('../database');
const MediaQueue = require('../MediaQueue');
const ImageAnalyzer = require('../ImageAnalyzer');
const LaionClient = require('./LaionClient');
const { saveEvidence } = require('../mediaUtils');

// Processo separado do bot (PM2: bootwhats-analyzer). Consome a fila
// media_analysis_jobs UMA por vez. Todo o custo de CPU — sharp, tfjs-node e o
// Python do LAION — mora aqui, longe do event loop que atende o WhatsApp.

const isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';
const idleMs = MediaQueue.toPositiveInt(process.env.WORKER_IDLE_MS, 1000);
const lockTimeoutMs = MediaQueue.toPositiveInt(process.env.JOB_LOCK_TIMEOUT_MS, 5 * 60_000);
const maxAttempts = MediaQueue.toPositiveInt(process.env.JOB_MAX_ATTEMPTS, 3);
const maxJobsBeforeExit = MediaQueue.toPositiveInt(process.env.ANALYZER_MAX_JOBS_BEFORE_EXIT, 500);
const staleSweepEveryMs = MediaQueue.toPositiveInt(process.env.JOB_STALE_SWEEP_MS, 60_000);
const evidenceDir = process.env.NSFW_EVIDENCE_DIR || './storage/deleted-media';

let analyzer;
let laionClient;
let running = true;
let jobsProcessed = 0;
let lastStaleSweep = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processJob(job) {
    // O cache vem ANTES de ler o arquivo: cinco pessoas postando a mesma
    // figurinha geram cinco jobs que compartilham um único arquivo de spool, e o
    // primeiro a terminar já pode tê-lo liberado. Uma inferência, cinco vereditos.
    const cached = await MediaQueue.findMediaHash(job.md5);
    if (cached) {
        const resolved = await MediaQueue.findResolvedByMd5(job.md5, job.id);
        await MediaQueue.completeJob(job.id, {
            isNsfw: cached.isNsfw,
            predictions: [{ className: 'Cached', probability: 1 }],
            evidencePath: resolved?.evidencePath || null
        });
        await MediaQueue.releaseSpoolFile(job);
        if (isDev) console.log(`Job ${job.id} (${job.md5.slice(0, 8)}): resolvido por cache.`);
        return;
    }

    let buffer;
    try {
        buffer = await fs.readFile(job.filePath);
    } catch (err) {
        // Sem o arquivo não há o que analisar e retentar não recupera os bytes.
        await MediaQueue.failJob(job.id, `arquivo de spool ausente: ${err?.message || err}`, {
            retryable: false,
            maxAttempts
        });
        return;
    }

    let verdict;
    try {
        verdict = await analyzer.analyze(buffer, {
            mimetype: job.mimetype,
            isSticker: (job.mimetype || '').includes('webp'),
            filePath: job.filePath
        });
    } catch (err) {
        await MediaQueue.failJob(job.id, `falha na análise: ${err?.message || err}`, {
            retryable: true,
            maxAttempts
        });
        return;
    }

    if (verdict.skipped) {
        // Formato não suportado: nada a decidir e nada a cachear (o md5 pode
        // reaparecer num container que o sharp entenda).
        await MediaQueue.failJob(job.id, verdict.reason, { retryable: false, maxAttempts });
        return;
    }

    if (verdict.isNsfw === null) {
        // LAION indisponível: não dá para decidir. Retenta; se esgotar, desiste
        // sem cachear e sem apagar nada.
        await MediaQueue.failJob(job.id, verdict.laionError || verdict.reason, {
            retryable: true,
            maxAttempts
        });
        return;
    }

    await MediaQueue.recordMediaHash(job.md5, verdict.isNsfw, job.fileHash);
    await finish(job, buffer, verdict);
}

async function finish(job, buffer, verdict) {
    let evidencePath = null;
    if (verdict.isNsfw) {
        try {
            evidencePath = await saveEvidence(buffer, {
                messageId: job.messageId,
                mimetype: job.mimetype,
                evidenceDir,
                md5: job.md5
            });
        } catch (err) {
            console.warn('Falha ao salvar evidência:', err?.message || err);
        }
    }

    await MediaQueue.completeJob(job.id, {
        isNsfw: verdict.isNsfw,
        predictions: verdict.predictions,
        evidencePath
    });
    await MediaQueue.releaseSpoolFile(job);

    if (isDev) {
        console.log(
            `Job ${job.id} (${job.md5.slice(0, 8)}): ${verdict.isNsfw ? 'NSFW' : 'ok'} — ${verdict.reason}`
        );
    }
}

async function loop() {
    while (running) {
        try {
            if (Date.now() - lastStaleSweep > staleSweepEveryMs) {
                lastStaleSweep = Date.now();
                const recovered = await MediaQueue.recoverStaleLocks({ lockTimeoutMs, maxAttempts });
                if (recovered) console.warn(`♻️ ${recovered} job(s) presos devolvidos à fila.`);
            }

            const job = await MediaQueue.claimNext();
            if (!job) {
                await sleep(idleMs);
                continue;
            }

            await processJob(job);
            jobsProcessed++;

            if (isDev && jobsProcessed % 10 === 0) {
                const mem = tf.memory();
                console.log(`🧠 tf.memory: ${mem.numTensors} tensores, ${Math.round(mem.numBytes / 1e6)}MB`);
            }

            // Reciclagem barata: reiniciar o worker não custa sessão do WhatsApp,
            // então qualquer resíduo de memória nativa é zerado periodicamente.
            if (jobsProcessed >= maxJobsBeforeExit) {
                console.log(`🔄 ${jobsProcessed} jobs processados — reiniciando para liberar memória.`);
                await shutdown(0);
                return;
            }
        } catch (err) {
            console.error('Erro no laço do worker:', err?.message || err);
            await sleep(idleMs);
        }
    }
}

async function shutdown(code = 0) {
    if (!running) return;
    running = false;
    laionClient?.stop();
    try {
        await prisma.$disconnect();
    } catch (_) {}
    process.exit(code);
}

// Um LAION_THRESHOLD muito baixo só fazia sentido com os embeddings quebrados
// pelo descasamento de QuickGELU: era compensação manual para o detector pegar
// alguma coisa. Com a variante corrigida, esse valor bloqueia quase tudo.
function warnIfThresholdUncalibrated() {
    const variant = laionClient.variant;
    if (variant === 'b32-legacy') return;
    if (analyzer.laionThreshold >= 0.1) return;

    console.warn(
        `\n⚠️  LAION_THRESHOLD=${analyzer.laionThreshold} com a variante "${variant}" (QuickGELU corrigido).\n` +
        '   Esse limiar foi calibrado para os embeddings antigos, com a ativação errada, e agora\n' +
        '   tende a bloquear conteúdo legítimo. Recalibre antes de confiar na moderação:\n' +
        '     node tools/nsfw_eval.js storage/eval\n'
    );
}

async function main() {
    await connectDatabase();

    const model = await nsfw.load('file://./models/inception_v3/', {
        type: 'inception_v3',
        size: 299
    });
    console.log('✅ Modelo de IA carregado no worker.');

    laionClient = new LaionClient();
    analyzer = new ImageAnalyzer(model, { inputSize: 299, laionClient });
    warnIfThresholdUncalibrated();

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
            console.log(`\n👋 ${signal} recebido, encerrando o worker...`);
            shutdown(0);
        });
    }

    console.log('🖼️ Worker de análise de imagens ATIVO.');
    await loop();
}

main().catch((err) => {
    console.error('❌ Worker encerrado por erro fatal:', err?.message || err);
    shutdown(1);
});
