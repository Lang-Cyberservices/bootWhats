const { execFile } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const ProxyPool = require('./ProxyPool');

// Download de video/audio com yt-dlp atraves do pool de proxies (ProxyPool).
// Fluxo: sonda os candidatos em paralelo pedindo so os metadados, descarta os
// que nao respondem e baixa pelo primeiro que aguentar o download inteiro.
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const PROBE_TIMEOUT_MS = 40_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
// Com esse tanto de proxies vivos a sondagem para: esperar os mortos estourarem
// o timeout so atrasa a resposta.
const PROBE_ENOUGH = 3;
const SOCKET_TIMEOUT_S = 10;
const MAX_BYTES = 16 * 1024 * 1024;
// Um download por vez; alem disso, quantos pedidos podem esperar na fila.
const MAX_WAITING = 3;

const KINDS = {
    video: {
        maxDurationS: 300,
        ext: 'mp4',
        // `bv+ba` e nao `bv*`: o formato combinado do YouTube (18) responde 403
        // no download; `/b` cobre os sites que so tem arquivo unico.
        // O teto de 11M no video deixa folga para o audio (~5 MB em 5 min)
        // dentro dos 16 MB: se o 480p nao couber, cai para uma resolucao menor.
        args: ['-f', 'bv[filesize<11M]+ba/bv+ba/b', '-S', 'vcodec:h264,res:480,acodec:m4a', '--merge-output-format', 'mp4', '--remux-video', 'mp4']
    },
    audio: {
        maxDurationS: 600,
        ext: 'mp3',
        args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '5']
    }
};

// "Sign in to confirm you're not a bot" e bloqueio do IP do proxy, nao do video.
const BOT_BLOCK_PATTERN = /confirm you.re not a bot/i;
// Erros que se repetiriam por qualquer proxy: nao contam como falha de ninguem.
const CONTENT_ERROR_PATTERN = /video (is )?(unavailable|not available)|private video|video is private|has been removed|no longer available|unsupported url|is not a valid url|members-only|confirm your age|age-restricted|no video formats found|there is no video in this/i;
const TOO_BIG_PATTERN = /larger than max-filesize/i;

class DownloadError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'DownloadError';
        this.code = code;
    }
}

function isPrivateHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
        return true;
    }

    if (net.isIPv4(host)) {
        const [a, b] = host.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }

    if (net.isIPv6(host)) {
        return host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:');
    }

    return !host.includes('.');
}

// So http(s) publico: o extrator generico do yt-dlp busca qualquer URL, e o bot
// nao deve servir de sonda para a rede interna do servidor.
function isAllowedUrl(raw) {
    try {
        const parsed = new URL(String(raw || ''));
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        return !isPrivateHost(parsed.hostname);
    } catch (_) {
        return false;
    }
}

function runYtDlp(args, timeoutMs, signal) {
    return new Promise((resolve) => {
        execFile(
            YTDLP_BIN,
            args,
            { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, signal },
            (err, stdout, stderr) => {
                resolve({
                    ok: !err,
                    missing: err?.code === 'ENOENT',
                    aborted: err?.name === 'AbortError',
                    stdout: String(stdout || ''),
                    stderr: String(stderr || '')
                });
            }
        );
    });
}

function baseArgs(proxy) {
    return [
        '--ignore-config',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout', String(SOCKET_TIMEOUT_S),
        '--retries', '1',
        '--proxy', ProxyPool.toUrl(proxy)
    ];
}

async function probe(proxy, url, signal) {
    const result = await runYtDlp(
        [...baseArgs(proxy), '--skip-download', '--print', '%(duration)s', '--print', '%(title)s', '--', url],
        PROBE_TIMEOUT_MS,
        signal
    );

    if (result.missing) return { proxy, status: 'missing' };
    if (result.aborted) return { proxy, status: 'aborted' };
    if (result.ok) {
        const [durationLine = '', ...titleLines] = result.stdout.trim().split('\n');
        const duration = Number(durationLine);
        return {
            proxy,
            status: 'ok',
            // Lives e alguns sites nao informam duracao ("NA").
            duration: Number.isFinite(duration) ? duration : null,
            title: titleLines.join(' ').trim() || null
        };
    }

    if (!BOT_BLOCK_PATTERN.test(result.stderr) && CONTENT_ERROR_PATTERN.test(result.stderr)) {
        return { proxy, status: 'content', detail: result.stderr.trim().split('\n').pop() };
    }
    return { proxy, status: 'fail' };
}

async function findOutputFile(dir, ext) {
    const names = (await fs.readdir(dir)).filter((name) => !name.endsWith('.part') && !name.endsWith('.ytdl'));
    const preferred = names.find((name) => name.endsWith(`.${ext}`));
    const chosen = preferred || names[0];
    return chosen ? path.join(dir, chosen) : null;
}

// Tenta o download completo por um proxy. Devolve { buffer, ext } ou null se o
// proxy falhou; lanca DownloadError quando o problema e do conteudo.
async function downloadThrough(proxy, url, kind) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dio-media-'));
    try {
        const result = await runYtDlp(
            [
                ...baseArgs(proxy),
                ...kind.args,
                '--match-filters', '!is_live',
                '--max-filesize', '16M',
                '-o', path.join(dir, 'media.%(ext)s'),
                '--',
                url
            ],
            DOWNLOAD_TIMEOUT_MS
        );

        if (result.missing) throw new DownloadError('YTDLP_MISSING');
        if (TOO_BIG_PATTERN.test(result.stdout) || TOO_BIG_PATTERN.test(result.stderr)) {
            throw new DownloadError('TOO_BIG');
        }
        if (!result.ok) return null;

        const filePath = await findOutputFile(dir, kind.ext);
        // Saida limpa sem arquivo: o --match-filters pulou o item (live).
        if (!filePath) throw new DownloadError('CONTENT', 'transmissão ao vivo');

        const buffer = await fs.readFile(filePath);
        if (buffer.length > MAX_BYTES) throw new DownloadError('TOO_BIG');
        if (!buffer.length) return null;

        return { buffer, ext: path.extname(filePath).slice(1).toLowerCase() };
    } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

async function fetchMedia(url, kindName) {
    const kind = KINDS[kindName];
    const candidates = await ProxyPool.pickCandidates();
    if (!candidates.length) throw new DownloadError('NO_PROXIES');

    // Os proxies ainda pendentes quando a sondagem para sao abortados sem levar
    // falha: nao da para saber se estavam mortos ou so mais lentos.
    const enough = new AbortController();
    let answered = 0;
    const probes = await Promise.all(candidates.map(async (proxy) => {
        const result = await probe(proxy, url, enough.signal);
        if (result.status === 'ok' && ++answered >= PROBE_ENOUGH) enough.abort();
        return result;
    }));
    if (probes.some((p) => p.status === 'missing')) throw new DownloadError('YTDLP_MISSING');

    await Promise.all(probes.filter((p) => p.status === 'fail').map((p) => ProxyPool.recordFail(p.proxy.id)));

    // A ordem de `candidates` e a do ranking, e Promise.all a preserva.
    const alive = probes.filter((p) => p.status === 'ok');
    if (!alive.length) {
        const content = probes.find((p) => p.status === 'content');
        if (content) throw new DownloadError('CONTENT', content.detail);
        throw new DownloadError('ALL_PROXIES_FAILED');
    }

    console.log(`📥 ${kindName}: ${alive.length}/${candidates.length} proxies responderam à sondagem.`);

    const { duration, title } = alive[0];
    if (duration !== null && duration > kind.maxDurationS) throw new DownloadError('TOO_LONG');

    for (const { proxy } of alive) {
        const file = await downloadThrough(proxy, url, kind);
        if (file) {
            await ProxyPool.recordSuccess(proxy.id);
            console.log(`📥 ${kindName}: baixado pelo proxy #${proxy.id} (${file.buffer.length} bytes).`);
            return { ...file, title, proxyId: proxy.id };
        }
        await ProxyPool.recordFail(proxy.id);
    }

    throw new DownloadError('ALL_PROXIES_FAILED');
}

let chain = Promise.resolve();
let pending = 0;

// Serializa os downloads: cada um ja abre ate POOL_SIZE processos de yt-dlp na
// sondagem, entao pedidos simultaneos se empilhariam rapido.
function download(url, kindName) {
    if (!KINDS[kindName]) return Promise.reject(new Error(`tipo de mídia desconhecido: ${kindName}`));
    if (pending > MAX_WAITING) return Promise.reject(new DownloadError('QUEUE_FULL'));

    pending++;
    const run = chain.then(() => fetchMedia(url, kindName)).finally(() => {
        pending--;
    });
    chain = run.catch(() => {});
    return run;
}

module.exports = { download, isAllowedUrl, DownloadError, KINDS };
