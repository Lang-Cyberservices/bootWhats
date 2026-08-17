const { spawn } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs/promises');
const path = require('node:path');

// Mantém UM processo Python vivo (tools/laion_score.py --serve) em vez de dar
// spawn por imagem. O modelo CLIP + safety model carregam uma vez só, e o
// processo é morto explicitamente nos sinais de saída — era daí que vinham os
// órfãos travando a máquina.
class LaionClient {
    constructor(options = {}) {
        this.python = options.python || process.env.LAION_PYTHON || 'python3';
        this.script = options.script || process.env.LAION_SCRIPT || 'tools/laion_score.py';
        // Par backbone CLIP + cabeça de classificação. Ver VARIANTS em
        // tools/laion_score.py; o avaliador sobe um cliente por variante.
        this.variant = options.variant || process.env.LAION_VARIANT || 'b32';
        this.requestTimeoutMs = toPositiveInt(process.env.LAION_REQUEST_TIMEOUT_MS, 120_000);
        this.startTimeoutMs = toPositiveInt(process.env.LAION_START_TIMEOUT_MS, 300_000);
        // 0 desliga o auto-shutdown; qualquer valor > 0 devolve a RAM do Python
        // quando não chega imagem duvidosa por esse tempo.
        this.idleShutdownMs = toNonNegativeInt(process.env.LAION_IDLE_SHUTDOWN_MS, 30 * 60_000);
        this.isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';

        this.child = null;
        this.ready = null;
        this.rl = null;
        this.pending = new Map();
        this.nextId = 1;
        this.queue = Promise.resolve();
        this.idleTimer = null;
        this.shuttingDown = false;

        this.handleProcessExit = () => this.stop();
        for (const signal of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
            process.on(signal, this.handleProcessExit);
        }
    }

    // Uma requisição por vez: o Python é CPU-bound e paralelizar aqui recria
    // exatamente o problema que este serviço existe para resolver.
    async score(imagePath) {
        const run = this.queue.then(
            () => this.scoreNow(imagePath),
            () => this.scoreNow(imagePath)
        );
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }

    async scoreNow(imagePath) {
        if (this.shuttingDown) throw new Error('LaionClient encerrado');
        this.clearIdleTimer();

        try {
            await this.ensureStarted();
            return await this.request({ path: path.resolve(imagePath) });
        } finally {
            this.scheduleIdleShutdown();
        }
    }

    async ensureStarted() {
        if (this.ready) return this.ready;

        this.ready = (async () => {
            const scriptPath = await this.resolveScriptPath();
            const child = spawn(
                this.python,
                [scriptPath, '--serve', '--device', 'cpu', '--variant', this.variant],
                { stdio: ['pipe', 'pipe', 'pipe'] }
            );

            this.child = child;
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk) => {
                if (this.isDev) console.warn('[laion]', String(chunk).trimEnd());
            });

            this.rl = readline.createInterface({ input: child.stdout });
            this.rl.on('line', (line) => this.onLine(line));

            child.on('error', (err) => this.onChildGone(err));
            child.on('exit', (code, signal) =>
                this.onChildGone(new Error(`processo LAION saiu (code=${code} signal=${signal})`))
            );

            await this.waitForReady(child);
            console.log(`🐍 LAION pronto (processo persistente, variante ${this.variant}).`);
        })();

        try {
            return await this.ready;
        } catch (err) {
            this.ready = null;
            this.killChild();
            throw err;
        }
    }

    waitForReady(child) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('timeout ao iniciar o processo LAION'));
            }, this.startTimeoutMs);

            const cleanup = () => {
                clearTimeout(timer);
                this.readyResolve = null;
                this.readyReject = null;
            };

            this.readyResolve = () => {
                cleanup();
                resolve();
            };
            this.readyReject = (err) => {
                cleanup();
                reject(err);
            };

            if (child.exitCode !== null) {
                this.readyReject(new Error('processo LAION morreu antes de ficar pronto'));
            }
        });
    }

    onLine(line) {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;

        let payload;
        try {
            payload = JSON.parse(trimmed);
        } catch (_) {
            if (this.isDev) console.warn('[laion] linha ignorada:', trimmed.slice(0, 200));
            return;
        }

        if (payload.ready === true) {
            this.readyResolve?.();
            return;
        }
        if (payload.ready === false) {
            this.readyReject?.(new Error(payload.error || 'falha ao carregar o modelo LAION'));
            return;
        }

        const entry = this.pending.get(payload.id);
        if (!entry) return;
        this.pending.delete(payload.id);
        clearTimeout(entry.timer);

        if (payload.error) {
            entry.reject(new Error(payload.error));
            return;
        }
        const score = Number(payload.score);
        if (!Number.isFinite(score)) {
            entry.reject(new Error('LAION score inválido'));
            return;
        }
        entry.resolve(score);
    }

    request(payload) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                // Estourou o tempo: o Python provavelmente está preso em código
                // nativo. Matar e deixar reiniciar é mais seguro que esperar.
                reject(new Error('timeout na análise LAION'));
                this.restart();
            }, this.requestTimeoutMs);

            this.pending.set(id, { resolve, reject, timer });

            try {
                this.child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
            } catch (err) {
                this.pending.delete(id);
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    onChildGone(err) {
        this.readyReject?.(err);
        this.ready = null;
        this.child = null;
        this.rl?.close();
        this.rl = null;

        for (const [, entry] of this.pending) {
            clearTimeout(entry.timer);
            entry.reject(err);
        }
        this.pending.clear();
    }

    restart() {
        this.killChild();
        this.ready = null;
    }

    killChild() {
        const child = this.child;
        if (!child) return;
        this.child = null;
        this.rl?.close();
        this.rl = null;
        try {
            child.kill('SIGKILL');
        } catch (_) {}
    }

    scheduleIdleShutdown() {
        this.clearIdleTimer();
        if (!this.idleShutdownMs || !this.child) return;
        this.idleTimer = setTimeout(() => {
            if (this.pending.size) return;
            console.log('🐍 LAION ocioso — liberando memória.');
            this.restart();
        }, this.idleShutdownMs);
        this.idleTimer.unref?.();
    }

    clearIdleTimer() {
        if (!this.idleTimer) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }

    stop() {
        if (this.shuttingDown) return;
        this.shuttingDown = true;
        this.clearIdleTimer();
        this.killChild();
    }

    async resolveScriptPath() {
        const candidate = this.script;
        const abs = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
        try {
            const stat = await fs.stat(abs);
            if (stat.isDirectory()) return path.join(abs, 'laion_score.py');
        } catch (_) {}
        return abs;
    }
}

function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toNonNegativeInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

module.exports = LaionClient;
