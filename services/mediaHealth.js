// O pipeline de mídia do WhatsApp Web às vezes trava por dentro da página:
// download e upload param de resolver enquanto texto segue normal e o socket
// continua CONNECTED — o watchdog de getState() não enxerga. Sem um teto aqui,
// cada chamada ficava presa até o protocolTimeout do Puppeteer (5 min).
// Este módulo dá o teto e conta timeouts seguidos para o index.js reconectar.
const OP_TIMEOUT_MS = Number(process.env.MEDIA_OP_TIMEOUT_MS) || 60_000;
const STALL_THRESHOLD = Number(process.env.MEDIA_STALL_THRESHOLD) || 3;

let consecutiveTimeouts = 0;
let lastStallAt = 0;
let stallHandler = null;

function onStall(fn) {
    stallHandler = fn;
}

function recordSuccess() {
    consecutiveTimeouts = 0;
}

function recordTimeout(label, startedAt) {
    // Operações iniciadas antes da última reconexão morreram junto com o
    // Chromium antigo; não dizem nada sobre o cliente novo.
    if (startedAt < lastStallAt) return;

    consecutiveTimeouts++;
    console.warn(`⏱️ Mídia sem resposta em ${OP_TIMEOUT_MS}ms (${label}) — ${consecutiveTimeouts}/${STALL_THRESHOLD}`);
    if (consecutiveTimeouts < STALL_THRESHOLD) return;

    consecutiveTimeouts = 0;
    lastStallAt = Date.now();
    Promise.resolve()
        .then(() => stallHandler?.({ label, threshold: STALL_THRESHOLD, timeoutMs: OP_TIMEOUT_MS }))
        .catch((err) => console.error('Erro ao tratar travamento de mídia:', err?.message || err));
}

// Só timeout conta como falha: mídia expirada ou erro comum rejeitam rápido e
// não indicam pipeline travado.
function withMediaTimeout(promise, label) {
    const startedAt = Date.now();
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            recordTimeout(label, startedAt);
            reject(new Error(`media-timeout: ${label}`));
        }, OP_TIMEOUT_MS);
    });

    // A promise original ainda rejeita depois (protocolTimeout, ou "Target
    // closed" quando o Chromium é morto). Sem este catch ela cairia no
    // unhandledRejection do index.js, que derruba o processo.
    Promise.resolve(promise).catch(() => {});

    return Promise.race([
        Promise.resolve(promise).then((value) => {
            if (startedAt >= lastStallAt) recordSuccess();
            return value;
        }),
        timeout
    ]).finally(() => clearTimeout(timer));
}

module.exports = { withMediaTimeout, onStall };
