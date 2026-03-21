const { getSenderId } = require('./messageUtils');


class LlamaResponder {
    constructor({ auditLogger } = {}) {
        this.auditLogger = auditLogger;
        this.botId = null;
        this.botUserId = null;

        this.fetchFn = typeof globalThis.fetch === 'function'
            ? globalThis.fetch.bind(globalThis)
            : null;

        if (!this.fetchFn) {
            console.warn('LlamaResponder desativado: a API fetch não está disponível no ambiente.');
            this.enabled = false;
            return;
        }

        this.enabled = (process.env.LLAMA_ENABLED || 'true').toLowerCase() !== 'false';
        if (!this.enabled) {
            console.log('LlamaResponder desativado via LLAMA_ENABLED=false.');
            return;
        }

        this.apiKey = (process.env.LLAMA_API_KEY || '').trim() || null;

        this.requestTimeoutMs = this.parsePositiveInt(process.env.LLAMA_REQUEST_TIMEOUT_MS, 120_000);
        this.allowCommands = (process.env.LLAMA_HANDLE_COMMANDS || 'false').toLowerCase() === 'true';
        this.model = (process.env.LLAMA_MODEL || 'diogenes').trim();

        this.endpoint = this.resolveEndpoint();
        if (!this.endpoint) {
            console.warn('LlamaResponder desativado: não foi possível determinar o endpoint da API.');
            this.enabled = false;
        }
    }

    parsePositiveInt(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    }

    parseNumber(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    resolveEndpoint() {
        const envEndpoint = (process.env.LLAMA_ENDPOINT || '').trim();
        if (envEndpoint) {
            return envEndpoint;
        }

        const protocol = (process.env.LLAMA_PROTOCOL || 'http').replace(/:\/?$/g, '').trim();
        const host = (process.env.LLAMA_HOST || '127.0.0.1').trim().replace(/\/+$/g, '');
        const port = (process.env.LLAMA_PORT || '11434').trim();
        const rawPath = (process.env.LLAMA_API_PATH || '/v1/chat/completions').trim();
        const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

        if (!protocol || !host) return null;

        const portSegment = port ? `:${port}` : '';
        return `${protocol}://${host}${portSegment}${path}`;
    }

    setBotId(id) {
        this.botId = id || null;
        this.botUserId = this.extractUserId(this.botId);
    }

    async handleMessage(msg, chat) {
        if (!this.enabled || !this.endpoint || !msg || msg.fromMe) {
            return;
        }
       

        const trigger = await this.buildTriggerContext(msg);
        if (!trigger) {
            return;
        }
        

        const responseText = await this.callLlama(trigger);
        if (!responseText) {
            return;
        }

        try {
            await msg.reply(responseText);
            await this.auditLogger?.log('LLAMA_RESPONSE', {
                chatId: chat?.id?._serialized,
                authorId: getSenderId(msg),
                phone: msg._authorPhone || null,
                messageId: msg.id?._serialized || msg.id?.id,
                content: responseText,
                details: { reason: trigger.reason }
            });
        } catch (err) {
            console.error('LlamaResponder: falha ao responder no grupo:', err?.message || err);
        }
    }

    async buildTriggerContext(msg) {
        const rawBody = String(msg.body || '').trim();
        if (!rawBody) {
            return null;
        }

        const mentionedIds = (Array.isArray(msg.mentionedIds) ? msg.mentionedIds : [])
            .map((id) => (typeof id === 'string' ? id : id?._serialized))
            .filter(Boolean);

        const isMention = Boolean(
            this.botUserId &&
            mentionedIds.some((jid) => this.extractUserId(jid) === this.botUserId)
        );

        let quotedMessage = null;
        if (msg.hasQuotedMsg) {
            try {
                quotedMessage = await msg.getQuotedMessage();
            } catch (err) {
                quotedMessage = null;
            }
        }
        

        const isReplyToBot = this.isMessageFromBot(quotedMessage);
        if (!isMention && !isReplyToBot) {
            return null;
        }

        const quotedText = this.extractTextFromMessage(quotedMessage);
        const reason = isMention ? 'mention' : 'reply';

        return {
            body: rawBody,
            reason,
            quotedText
        };
    }

    extractTextFromMessage(msg) {
        if (!msg) return null;
        const parts = [];
        if (typeof msg.body === 'string' && msg.body.trim()) {
            parts.push(msg.body.trim());
        }
        if (typeof msg.caption === 'string' && msg.caption.trim()) {
            parts.push(msg.caption.trim());
        }
        return parts.length ? parts.join('\n') : null;
    }

    isMessageFromBot(msg) {
        if (!msg) return false;
        if (msg.fromMe) {
            return true;
        }
        const candidate = msg.author || msg.from || msg.id?.participant || null;
        return !!(candidate && this.isBotCandidate(candidate));
    }

    extractUserId(jid) {
        if (typeof jid !== 'string') return null;
        const [userPart] = jid.split('@');
        return userPart || null;
    }

    isBotCandidate(candidate) {
        const candidateId = this.extractUserId(candidate);
        return Boolean(candidateId && this.botUserId && candidateId === this.botUserId);
    }

    async callLlama(trigger) {
        const reasonText = trigger.reason === 'mention'
            ? 'Você foi mencionado e o grupo espera uma resposta.'
            : 'Alguém respondeu a uma de suas mensagens.';

        const lines = [reasonText];
        if (trigger.quotedText) {
            lines.push(`Mensagem citada:\n${trigger.quotedText}`);
        }
        lines.push(trigger.body);

        const userMessage = lines.filter(Boolean).join('\n\n');
        const payload = {
            model: this.model,
            prompt: userMessage,
            stream: false
        };

        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        try {
            const response = await this.fetchFn(this.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!response.ok) {
                const text = await response.text().catch(() => 'sem corpo');
                console.warn(`LlamaResponder: resposta ${response.status} ${response.statusText}: ${text}`);
                return null;
            }

            const parsed = await response.json().catch((err) => {
                console.warn('LlamaResponder: falha ao parsear JSON da resposta do Llama:', err?.message || err);
                return null;
            });

            const rawChoice = Array.isArray(parsed?.choices) ? parsed.choices[0] : null;
            const content = rawChoice?.message?.content || rawChoice?.content || rawChoice?.text;
            if (typeof content === 'string' && content.trim()) {
                return content.trim();
            }

            const fallbackText = typeof parsed?.response === 'string'
                ? parsed.response.trim()
                : null;
            if (fallbackText) {
                return fallbackText;
            }

            return null;
        } catch (err) {
            if (err?.name === 'AbortError') {
                console.warn('LlamaResponder: tempo excedido ao consultar o Llama.');
            } else {
                console.error('LlamaResponder: erro ao chamar o Llama:', err?.message || err);
            }
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }
}

module.exports = LlamaResponder;
