// Segunda opinião da moderação de imagens: Google Cloud Vision, feature
// SAFE_SEARCH_DETECTION. É uma chamada HTTP sem processo residente — o oposto do
// sidecar Python que existia aqui antes, que carregava ~1,5 GB de CLIP.
//
// Autentica por API key na query string (o mesmo padrão do GEMINI_API_KEY). O SDK
// oficial só aceita service account, e não vale a árvore de gRPC/protobuf por uma
// única chamada REST.
//
// TODO caminho de falha é exceção, de propósito: é assim que o ImageAnalyzer
// distingue "liberado" de "não deu para decidir". Devolver um veredito otimista
// aqui liberaria conteúdo silenciosamente quando a API estivesse fora.

// Ordem da escala de likelihood da API. UNKNOWN fica em 0 para nunca bloquear
// sozinho — a API o devolve quando não conseguiu avaliar.
const LEVELS = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];

function rankLevel(level) {
    const index = LEVELS.indexOf(String(level || '').toUpperCase());
    return index < 0 ? 0 : index;
}

function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class VisionClient {
    constructor(options = {}) {
        this.apiKey = String(options.apiKey ?? process.env.GOOGLE_VISION_API_KEY ?? '').trim();
        this.endpoint =
            options.endpoint ||
            process.env.GOOGLE_VISION_ENDPOINT ||
            'https://vision.googleapis.com/v1/images:annotate';
        this.timeoutMs = toPositiveInt(process.env.GOOGLE_VISION_TIMEOUT_MS, 15_000);
        this.isDev = (process.env.APP_ENV || '').toLowerCase() === 'development';
    }

    get enabled() {
        return !!this.apiKey;
    }

    /**
     * @param {Buffer} buffer bytes da imagem (JPEG/PNG estático)
     * @returns {Promise<{adult: string, racy: string, violence: string, spoof: string, medical: string}>}
     */
    async safeSearch(buffer) {
        if (!this.enabled) throw new Error('GOOGLE_VISION_API_KEY não configurada');
        if (!buffer?.length) throw new Error('imagem vazia para o Vision');

        const body = JSON.stringify({
            requests: [
                {
                    image: { content: buffer.toString('base64') },
                    features: [{ type: 'SAFE_SEARCH_DETECTION' }]
                }
            ]
        });

        let response;
        try {
            response = await fetch(`${this.endpoint}?key=${encodeURIComponent(this.apiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(this.timeoutMs)
            });
        } catch (err) {
            // Timeout e falha de rede chegam aqui. A mensagem vai para a coluna
            // `error` do job, então precisa dizer o que aconteceu.
            const reason = err?.name === 'TimeoutError' ? `timeout após ${this.timeoutMs}ms` : err?.message || String(err);
            throw new Error(`Vision indisponível: ${reason}`);
        }

        const payload = await this.readJson(response);

        if (!response.ok) {
            const detail = payload?.error?.message || `HTTP ${response.status}`;
            throw new Error(`Vision respondeu ${response.status}: ${detail}`);
        }

        // A API devolve 200 com erro por item quando o problema é da imagem.
        const result = payload?.responses?.[0];
        if (result?.error) {
            throw new Error(`Vision recusou a imagem: ${result.error.message || 'erro sem mensagem'}`);
        }

        const annotation = result?.safeSearchAnnotation;
        if (!annotation) throw new Error('Vision respondeu sem safeSearchAnnotation');

        if (this.isDev) console.log('Vision SafeSearch:', annotation);

        return {
            adult: annotation.adult || 'UNKNOWN',
            racy: annotation.racy || 'UNKNOWN',
            violence: annotation.violence || 'UNKNOWN',
            spoof: annotation.spoof || 'UNKNOWN',
            medical: annotation.medical || 'UNKNOWN'
        };
    }

    // Erro de quota costuma vir em HTML ou texto puro; sem isto o JSON.parse
    // estouraria e esconderia o status real da resposta.
    async readJson(response) {
        try {
            return await response.json();
        } catch (_) {
            return null;
        }
    }
}

module.exports = VisionClient;
module.exports.LEVELS = LEVELS;
module.exports.rankLevel = rankLevel;
