const { EventEmitter } = require('node:events');

function normalizeJid(value, fallbackServer = 's.whatsapp.net') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.includes('@')) return raw;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return raw;
    return `${digits}@${fallbackServer}`;
}

function jidToAddress(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.endsWith('@g.us')) return raw;
    if (raw.endsWith('@s.whatsapp.net')) return raw;
    if (raw.endsWith('@lid')) return raw;
    return raw.replace(/\D/g, '');
}

function normalizeEventName(value) {
    return String(value || '')
        .trim()
        .replace(/\./g, '_')
        .replace(/-/g, '_')
        .toUpperCase();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class EvolutionApiClient extends EventEmitter {
    constructor(options = {}) {
        super();
        this.baseUrl = String(options.baseUrl || '').replace(/\/+$/g, '');
        this.globalApiKey = String(options.globalApiKey || '').trim();
        this.instanceName = String(options.instanceName || '').trim();
        this.instanceToken = String(options.instanceToken || '').trim();
        this.integration = String(options.integration || 'WHATSAPP-BAILEYS').trim();
        this.ownerNumber = String(options.ownerNumber || '').trim();
        this.webhookSecret = String(options.webhookSecret || '').trim();
        this.fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
        this.info = {
            wid: {
                _serialized: this.ownerNumber ? normalizeJid(this.ownerNumber) : null
            }
        };
        this.contactCache = new Map();
        this.groupCache = new Map();
        this.messageCache = new Map();
        this.lastQrAt = 0;
        this.ready = false;
    }

    assertConfigured() {
        if (!this.fetchFn) throw new Error('A API fetch não está disponível neste ambiente.');
        if (!this.baseUrl) throw new Error('EVOLUTION_API_URL não configurada.');
        if (!this.globalApiKey) throw new Error('EVOLUTION_GLOBAL_API_KEY não configurada.');
        if (!this.instanceName) throw new Error('EVOLUTION_INSTANCE_NAME não configurada.');
    }

    getAuthHeader(useInstanceToken = false) {
        if (useInstanceToken && this.instanceToken) return this.instanceToken;
        return this.globalApiKey;
    }

    async request(method, path, { body, query, useInstanceToken = false, headers } = {}) {
        this.assertConfigured();

        const url = new URL(`${this.baseUrl}${path}`);
        if (query && typeof query === 'object') {
            for (const [key, value] of Object.entries(query)) {
                if (value === undefined || value === null || value === '') continue;
                url.searchParams.set(key, String(value));
            }
        }

        const response = await this.fetchFn(url, {
            method,
            headers: {
                apikey: this.getAuthHeader(useInstanceToken),
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...(headers || {})
            },
            body: body ? JSON.stringify(body) : undefined
        });

        const text = await response.text();
        const parsed = text ? this.safeJsonParse(text) : null;
        if (!response.ok) {
            const details = parsed || text || response.statusText;
            throw new Error(`Evolution API ${method} ${path} falhou (${response.status}): ${typeof details === 'string' ? details : JSON.stringify(details)}`);
        }

        return parsed;
    }

    safeJsonParse(value) {
        try {
            return JSON.parse(value);
        } catch (_) {
            return value;
        }
    }

    extractInstanceRows(response) {
        if (Array.isArray(response)) return response;
        if (Array.isArray(response?.response)) return response.response;
        if (Array.isArray(response?.instances)) return response.instances;
        if (Array.isArray(response?.data)) return response.data;
        return response && typeof response === 'object' ? [response] : [];
    }

    getInstanceName(row) {
        const instance = row?.instance || row;
        return String(instance?.instanceName || instance?.name || row?.instanceName || row?.name || '').trim();
    }

    async fetchInstance({ useQuery = true } = {}) {
        const response = await this.request('GET', '/instance/fetchInstances', {
            query: useQuery ? { instanceName: this.instanceName } : undefined
        });
        const rows = this.extractInstanceRows(response);
        const found = rows.find((row) => this.getInstanceName(row) === this.instanceName);
        return found?.instance || found || null;
    }

    async ensureInstance(webhookUrl) {
        let instance = null;
        try {
            instance = await this.fetchInstance();
        } catch (_) {}

        if (!instance) {
            try {
                const created = await this.request('POST', '/instance/create', {
                    body: {
                        instanceName: this.instanceName,
                        integration: this.integration,
                        token: this.instanceToken || undefined,
                        qrcode: false,
                        number: this.ownerNumber || undefined,
                        rejectCall: false,
                        msgCall: '',
                        groupsIgnore: false,
                        alwaysOnline: false,
                        readMessages: false,
                        readStatus: false,
                        syncFullHistory: false,
                        webhook: {
                            url: webhookUrl,
                            byEvents: false,
                            base64: true,
                            headers: this.webhookSecret
                                ? { 'x-evolution-secret': this.webhookSecret }
                                : {},
                            events: [
                                'QRCODE_UPDATED',
                                'MESSAGES_UPSERT',
                                'SEND_MESSAGE',
                                'GROUP_PARTICIPANTS_UPDATE',
                                'CONNECTION_UPDATE'
                            ]
                        }
                    }
                });
                instance = created?.instance || null;
            } catch (err) {
                if (!String(err?.message || err).includes('already in use')) throw err;
                instance = await this.fetchInstance({ useQuery: false });
                if (!instance) throw err;
            }
        }

        await this.configureWebhook(webhookUrl);

        await this.request('POST', `/settings/set/${this.instanceName}`, {
            body: {
                rejectCall: false,
                msgCall: '',
                groupsIgnore: false,
                alwaysOnline: false,
                readMessages: false,
                readStatus: false,
                syncFullHistory: false
            }
        });

        if (!this.instanceToken) {
            const refreshed = await this.fetchInstance();
            this.instanceToken = String(refreshed?.apikey || refreshed?.integration?.token || this.instanceToken || '').trim();
        }

        if (instance?.owner) {
            this.info.wid._serialized = instance.owner;
        }

        return instance;
    }

    async configureWebhook(webhookUrl) {
        const events = [
            'QRCODE_UPDATED',
            'MESSAGES_UPSERT',
            'SEND_MESSAGE',
            'GROUP_PARTICIPANTS_UPDATE',
            'CONNECTION_UPDATE'
        ];
        const headers = this.webhookSecret
            ? { 'x-evolution-secret': this.webhookSecret }
            : {};
        const attempts = [
            {
                enabled: true,
                url: webhookUrl,
                webhookByEvents: false,
                webhookBase64: true,
                headers,
                events
            },
            {
                enabled: true,
                url: webhookUrl,
                webhook_by_events: false,
                webhook_base64: true,
                headers,
                events
            },
            {
                webhook: {
                    enabled: true,
                    url: webhookUrl,
                    byEvents: false,
                    base64: true,
                    headers,
                    events
                }
            }
        ];
        const errors = [];

        for (const body of attempts) {
            try {
                return await this.request('POST', `/webhook/set/${this.instanceName}`, { body });
            } catch (err) {
                errors.push(err?.message || String(err));
            }
        }

        throw new Error(`Falha ao configurar webhook da Evolution API: ${errors.join(' | ')}`);
    }

    async getConnectionState() {
        const response = await this.request('GET', `/instance/connectionState/${this.instanceName}`);
        return String(response?.instance?.state || response?.state || '').toLowerCase();
    }

    async connectInstance() {
        return this.request('GET', `/instance/connect/${this.instanceName}`);
    }

    async ensureConnected({ qrCooldownMs = 15000 } = {}) {
        const state = await this.getConnectionState();
        if (state === 'open') {
            if (!this.ready) {
                this.ready = true;
                this.emit('ready');
            }
            return { state };
        }

        const now = Date.now();
        if (now - this.lastQrAt >= qrCooldownMs) {
            this.lastQrAt = now;
            try {
                const data = await this.connectInstance();
                if (data?.code) {
                    this.emit('qr', data.code);
                }
            } catch (err) {
                this.emit('warn', err);
            }
        }

        return { state };
    }

    async getNumberId(number) {
        const jid = normalizeJid(number);
        return jid ? { _serialized: jid } : null;
    }

    buildQuotedPayload(quoted) {
        if (!quoted?.key?.id) return undefined;
        const text = this.extractTextFromMessageNode(quoted.message) || quoted?.body || quoted?.caption || ' ';
        const key = {
            id: quoted.key.id
        };
        if (quoted.key.remoteJid) key.remoteJid = quoted.key.remoteJid;
        if (typeof quoted.key.fromMe === 'boolean') key.fromMe = quoted.key.fromMe;
        if (quoted.key.participant) key.participant = quoted.key.participant;

        return {
            key,
            message: {
                conversation: text
            }
        };
    }

    buildSendOptionsPayload(options = {}) {
        const payload = {};
        if (options.linkPreview === true) payload.linkPreview = true;
        if (options.mentionsEveryOne === true) payload.mentionsEveryOne = true;
        const mentioned = Array.isArray(options.mentions) ? options.mentions.filter(Boolean) : [];
        if (mentioned.length) payload.mentioned = mentioned;
        const quoted = this.buildQuotedPayload(options.quoted);
        if (quoted) payload.quoted = quoted;
        return payload;
    }

    async sendText(chatId, text, options = {}) {
        return this.request('POST', `/message/sendText/${this.instanceName}`, {
            useInstanceToken: true,
            body: {
                number: jidToAddress(chatId),
                text,
                ...this.buildSendOptionsPayload(options)
            }
        });
    }

    async sendSticker(chatId, base64, options = {}) {
        await this.request('POST', `/message/sendSticker/${this.instanceName}`, {
            useInstanceToken: true,
            body: {
                number: jidToAddress(chatId),
                sticker: base64,
                ...this.buildSendOptionsPayload(options)
            }
        });
        return true;
    }

    inferMediaType(mimetype) {
        const mime = String(mimetype || '').toLowerCase();
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        if (mime.startsWith('audio/')) return 'audio';
        return 'document';
    }

    async sendMedia(chatId, media, options = {}) {
        return this.request('POST', `/message/sendMedia/${this.instanceName}`, {
            useInstanceToken: true,
            body: {
                number: jidToAddress(chatId),
                mediatype: this.inferMediaType(media?.mimetype),
                mimetype: media?.mimetype || 'application/octet-stream',
                caption: options.caption || '',
                media: media?.data || '',
                fileName: media?.filename || 'arquivo',
                ...this.buildSendOptionsPayload(options)
            }
        });
    }

    async sendMessage(chatId, content, options = {}) {
        let normalizedOptions = options;
        if (!normalizedOptions.quoted && normalizedOptions.quotedMessageId) {
            const quoted = await this.fetchMessageById(chatId, normalizedOptions.quotedMessageId);
            if (quoted) {
                normalizedOptions = {
                    ...normalizedOptions,
                    quoted
                };
            }
        }

        if (typeof content === 'string') {
            return this.sendText(chatId, content, normalizedOptions);
        }

        if (content && typeof content === 'object' && typeof content.data === 'string') {
            if (normalizedOptions.sendMediaAsSticker || String(content.mimetype || '').toLowerCase() === 'image/webp') {
                return this.sendSticker(chatId, content.data, normalizedOptions);
            }
            return this.sendMedia(chatId, content, normalizedOptions);
        }

        throw new Error('Tipo de mensagem não suportado para envio.');
    }

    async getContactById(id) {
        const jid = normalizeJid(id);
        if (!jid) return null;
        const cached = this.contactCache.get(jid);
        if (cached) return cached;

        let payload = null;
        try {
            payload = await this.request('POST', `/chat/findContacts/${this.instanceName}`, {
                useInstanceToken: true,
                body: {
                    where: {
                        id: jid
                    }
                }
            });
        } catch (_) {}

        const row = Array.isArray(payload)
            ? payload[0]
            : Array.isArray(payload?.contacts)
                ? payload.contacts[0]
                : Array.isArray(payload?.response)
                    ? payload.response[0]
                    : payload?.contact || payload?.response || payload;

        const digits = jid.replace(/\D/g, '');
        const contact = {
            id: { _serialized: jid, user: digits },
            number: digits || null,
            pushname: row?.pushName || row?.pushname || row?.name || null,
            name: row?.name || row?.pushName || null
        };
        this.contactCache.set(jid, contact);
        return contact;
    }

    async getGroupMetadata(chatId) {
        const jid = normalizeJid(chatId, 'g.us');
        const cached = this.groupCache.get(jid);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        const [groupsPayload, participantsPayload] = await Promise.all([
            this.request('GET', `/group/fetchAllGroups/${this.instanceName}`, {
                useInstanceToken: true,
                query: { getParticipants: 'false' }
            }).catch(() => []),
            this.request('GET', `/group/participants/${this.instanceName}`, {
                useInstanceToken: true,
                query: { groupJid: jid }
            }).catch(() => ({ participants: [] }))
        ]);

        const groups = Array.isArray(groupsPayload)
            ? groupsPayload
            : Array.isArray(groupsPayload?.response)
                ? groupsPayload.response
                : [];
        const group = groups.find((item) => item?.id === jid) || { id: jid };
        const participants = Array.isArray(participantsPayload?.participants)
            ? participantsPayload.participants.map((participant) => {
                const participantId = normalizeJid(participant?.id);
                return {
                    id: {
                        _serialized: participantId,
                        user: String(participantId).split('@')[0]
                    },
                    isAdmin: participant?.admin === 'admin' || participant?.admin === 'superadmin',
                    isSuperAdmin: participant?.admin === 'superadmin'
                };
            })
            : [];

        const value = {
            id: {
                _serialized: jid,
                user: String(jid).split('@')[0]
            },
            name: group?.subject || group?.name || jid,
            isGroup: true,
            participants
        };

        this.groupCache.set(jid, {
            value,
            expiresAt: Date.now() + 30000
        });

        return value;
    }

    extractTextFromMessageNode(node) {
        if (!node || typeof node !== 'object') return '';
        if (typeof node.conversation === 'string') return node.conversation;
        if (typeof node.extendedTextMessage?.text === 'string') return node.extendedTextMessage.text;
        if (typeof node.imageMessage?.caption === 'string') return node.imageMessage.caption;
        if (typeof node.videoMessage?.caption === 'string') return node.videoMessage.caption;
        if (typeof node.documentMessage?.caption === 'string') return node.documentMessage.caption;
        return '';
    }

    extractContextInfo(node) {
        if (!node || typeof node !== 'object') return null;
        const message = node.message && typeof node.message === 'object' ? node.message : node;
        return node.contextInfo
            || message.extendedTextMessage?.contextInfo
            || message.imageMessage?.contextInfo
            || message.videoMessage?.contextInfo
            || message.documentMessage?.contextInfo
            || message.stickerMessage?.contextInfo
            || message.buttonsResponseMessage?.contextInfo
            || message.listResponseMessage?.contextInfo
            || message.contextInfo
            || null;
    }

    extractMessageType(data) {
        const explicit = String(data?.messageType || '').trim();
        if (explicit) return explicit;
        const message = data?.message || {};
        const known = Object.keys(message).find((key) => key !== 'messageContextInfo');
        return known || 'conversation';
    }

    extractMediaNode(message, messageType) {
        if (!message || typeof message !== 'object') return null;
        if (messageType && message[messageType]) return message[messageType];
        const key = ['imageMessage', 'videoMessage', 'documentMessage', 'stickerMessage'].find((item) => message[item]);
        return key ? message[key] : null;
    }

    extractBase64Media(data) {
        const candidates = [
            data?.base64,
            data?.base64File,
            data?.message?.base64,
            data?.message?.base64File
        ];

        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
                if (candidate.startsWith('data:')) {
                    const [, base64Part] = candidate.split(',', 2);
                    return base64Part || '';
                }
                return candidate.trim();
            }
        }

        return null;
    }

    buildQuotedReference(data) {
        const contextInfo = this.extractContextInfo(data);
        if (!contextInfo?.stanzaId) return null;

        return {
            key: {
                id: contextInfo.stanzaId,
                remoteJid: contextInfo.remoteJid || data?.key?.remoteJid || null,
                fromMe: false,
                participant: contextInfo.participant || null
            },
            message: contextInfo.quotedMessage || null,
            pushName: null,
            messageType: contextInfo.quotedMessage ? Object.keys(contextInfo.quotedMessage)[0] : 'conversation'
        };
    }

    cacheMessage(rawMessage) {
        const id = rawMessage?.key?.id;
        if (!id) return;
        this.messageCache.set(id, rawMessage);
        if (this.messageCache.size > 500) {
            const firstKey = this.messageCache.keys().next().value;
            if (firstKey) {
                this.messageCache.delete(firstKey);
            }
        }
    }

    async fetchMessageById(chatId, messageId) {
        if (!messageId) return null;
        const cached = this.messageCache.get(messageId);
        if (cached) return cached;

        let payload = null;
        try {
            payload = await this.request('POST', `/chat/findMessages/${this.instanceName}`, {
                useInstanceToken: true,
                body: {
                    where: {
                        key: {
                            id: messageId,
                            remoteJid: normalizeJid(chatId, String(chatId).endsWith('@g.us') ? 'g.us' : 's.whatsapp.net')
                        }
                    }
                }
            });
        } catch (_) {}

        const rows = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.messages)
                ? payload.messages
                : Array.isArray(payload?.response)
                    ? payload.response
                    : [];
        const found = rows.find((item) => item?.key?.id === messageId) || null;
        if (found) this.cacheMessage(found);
        return found;
    }

    async getMessageMedia(rawMessage) {
        const messageId = rawMessage?.key?.id;
        if (!messageId) return null;

        const inlineBase64 = this.extractBase64Media(rawMessage);
        const messageType = this.extractMessageType(rawMessage);
        const mediaNode = this.extractMediaNode(rawMessage?.message, messageType);
        const mimetype = mediaNode?.mimetype || (messageType === 'stickerMessage' ? 'image/webp' : null);
        if (inlineBase64 && mimetype) {
            return {
                data: inlineBase64,
                mimetype,
                filename: mediaNode?.fileName || mediaNode?.caption || `${messageId}.${String(mimetype).split('/')[1] || 'bin'}`
            };
        }

        let payload = null;
        try {
            payload = await this.request('POST', `/chat/getBase64FromMediaMessage/${this.instanceName}`, {
                useInstanceToken: true,
                body: {
                    message: {
                        key: rawMessage.key,
                        message: rawMessage.message
                    },
                    convertToMp4: false
                }
            });
        } catch (_) {}

        const data = typeof payload === 'string'
            ? payload
            : payload?.base64 || payload?.data || payload?.response?.base64 || payload?.response || null;
        if (!data || typeof data !== 'string') return null;
        const clean = data.startsWith('data:') ? data.split(',', 2)[1] : data;

        return {
            data: clean,
            mimetype: mimetype || 'application/octet-stream',
            filename: mediaNode?.fileName || `${messageId}.${String(mimetype || 'application/octet-stream').split('/')[1] || 'bin'}`
        };
    }

    async deleteMessage(rawMessage) {
        const key = rawMessage?.key;
        if (!key?.id || !key?.remoteJid) return null;
        return this.request('DELETE', `/chat/deleteMessageForEveryone/${this.instanceName}`, {
            useInstanceToken: true,
            body: {
                id: key.id,
                remoteJid: key.remoteJid,
                fromMe: Boolean(key.fromMe),
                participant: key.participant || undefined
            }
        });
    }

    async removeParticipants(chatId, participantIds = []) {
        const participants = participantIds
            .map((item) => jidToAddress(item))
            .filter(Boolean);
        if (!participants.length) return null;
        return this.request('POST', `/group/updateParticipant/${this.instanceName}`, {
            useInstanceToken: true,
            query: { groupJid: chatId },
            body: {
                action: 'remove',
                participants
            }
        });
    }

    async buildChat(chatId) {
        if (String(chatId).endsWith('@g.us')) {
            const metadata = await this.getGroupMetadata(chatId);
            return new CompatibleChat(this, metadata);
        }

        return new CompatibleChat(this, {
            id: {
                _serialized: normalizeJid(chatId),
                user: String(chatId).split('@')[0]
            },
            name: chatId,
            isGroup: false,
            participants: []
        });
    }

    async buildMessage(rawMessage) {
        this.cacheMessage(rawMessage);
        const key = rawMessage?.key || {};
        const messageType = this.extractMessageType(rawMessage);
        const body = this.extractTextFromMessageNode(rawMessage?.message);
        const chatId = key.remoteJid || '';
        const author = key.participant || key.remoteJid || null;
        const contextInfo = this.extractContextInfo(rawMessage) || {};
        const mentionedIds = Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [];
        const mediaNode = this.extractMediaNode(rawMessage?.message, messageType);
        const hasMedia = Boolean(mediaNode);

        return new CompatibleMessage(this, rawMessage, {
            id: {
                _serialized: key.id || null,
                id: key.id || null,
                participant: key.participant || null
            },
            body,
            caption: mediaNode?.caption || '',
            from: chatId,
            author,
            fromMe: Boolean(key.fromMe),
            type: messageType === 'imageMessage'
                ? 'image'
                : messageType === 'stickerMessage'
                    ? 'sticker'
                    : messageType === 'videoMessage'
                        ? 'video'
                        : 'chat',
            mentionedIds,
            hasQuotedMsg: Boolean(contextInfo?.stanzaId),
            hasMedia,
            pushName: rawMessage?.pushName || null
        });
    }

    async handleWebhook(payload) {
        const eventName = normalizeEventName(payload?.event);
        const data = payload?.data;

        if (eventName === 'QRCODE_UPDATED') {
            const qr = data?.qrcode?.code || data?.code;
            if (qr) this.emit('qr', qr);
            return;
        }

        if (eventName === 'CONNECTION_UPDATE') {
            const state = String(data?.state || data?.status || '').toLowerCase();
            if (state === 'open') {
                this.ready = true;
                this.emit('ready');
            } else if (state && state !== 'open') {
                this.ready = false;
                this.emit('disconnected', state);
            }
            return;
        }

        if (eventName === 'MESSAGES_UPSERT') {
            const rows = Array.isArray(data) ? data : data ? [data] : [];
            for (const row of rows) {
                const msg = await this.buildMessage(row);
                this.emit('message', msg);
            }
            return;
        }

        if (eventName === 'GROUP_PARTICIPANTS_UPDATE') {
            const action = String(data?.action || '').toLowerCase();
            const participants = Array.isArray(data?.participants) ? data.participants : [];
            if (action === 'add' && participants.length) {
                const notification = new CompatibleNotification(this, data);
                this.emit('group_join', notification);
            }
        }
    }
}

class CompatibleChat {
    constructor(client, data) {
        this.client = client;
        this.id = data.id;
        this.name = data.name || '';
        this.isGroup = Boolean(data.isGroup);
        this.participants = Array.isArray(data.participants) ? data.participants : [];
    }

    async sendMessage(content, options = {}) {
        return this.client.sendMessage(this.id._serialized, content, options);
    }

    async removeParticipants(participantIds) {
        return this.client.removeParticipants(this.id._serialized, participantIds);
    }
}

class CompatibleMessage {
    constructor(client, raw, fields) {
        this.client = client;
        this.raw = raw;
        Object.assign(this, fields);
    }

    async reply(content, _chatId, options = {}) {
        return this.client.sendMessage(this.from, content, {
            ...options,
            quoted: this.raw
        });
    }

    async getChat() {
        return this.client.buildChat(this.from);
    }

    async getContact() {
        return this.client.getContactById(this.author || this.from);
    }

    async getQuotedMessage() {
        const quotedRef = this.client.buildQuotedReference(this.raw);
        if (!quotedRef?.key?.id) return null;
        const full = await this.client.fetchMessageById(this.from, quotedRef.key.id);
        return this.client.buildMessage(full || quotedRef);
    }

    async downloadMedia() {
        const media = await this.client.getMessageMedia(this.raw);
        if (!media) return null;
        return {
            mimetype: media.mimetype,
            data: media.data,
            filename: media.filename
        };
    }

    async delete() {
        return this.client.deleteMessage(this.raw);
    }
}

class CompatibleNotification {
    constructor(client, data) {
        this.client = client;
        this.data = data;
        this.recipients = Array.isArray(data?.participants) ? data.participants : [];
    }

    async getChat() {
        return this.client.buildChat(this.data?.id || this.data?.groupJid || this.data?.remoteJid);
    }
}

module.exports = {
    EvolutionApiClient,
    normalizeJid,
    jidToAddress,
    sleep
};
