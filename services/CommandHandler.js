const { getSenderId } = require('./messageUtils');
const sharp = require('sharp');
const { MessageMedia } = require('whatsapp-web.js');
const { prisma } = require('./database');
const ytdl = require('@distube/ytdl-core');
const { saveEvidence } = require('./mediaUtils');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { setTimeout: sleep } = require('node:timers/promises');

// Controle simples de flood por usuário (em memória)
const COMMAND_WINDOW_MS = 60_000;
const COTACAO_COOLDOWN_MS = 3 * 60 * 1000;
const DEFAULT_MAX_COMMANDS_PER_MINUTE = 3;
const MAX_COMMANDS_PER_MINUTE = (() => {
    const raw = process.env.MAX_COMMANDS_PER_MINUTE;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_COMMANDS_PER_MINUTE;
})();
const commandHistoryByUser = new Map(); // key: authorId, value: number[]
const NEWS_COOLDOWN_MS = 14 * 60_000;
const lastNewsRequestByUser = new Map(); // key: authorId, value: timestamp
let lastCotacaoRequestAt = 0;

const COTACAO_LABEL_BY_CODE = {
    USD: 'Dollar',
    CAD: 'Dollar Canadense',
    JPY: 'Yen',
    EUR: 'Euro',
    GBP: 'Libra',
    CNY: 'Yuan (Renminbi)',
    BTC: 'Bitcoin'
};

const COTACAO_EMOJI_BY_CODE = {
    USD: '🇺🇸',
    CAD: '🇨🇦',
    JPY: '🇯🇵',
    EUR: '🇪🇺',
    GBP: '🇬🇧',
    CNY: '🇨🇳',
    BTC: '💾'
};

const COTACAO_ALIASES = {
    dollar: 'USD',
    'dollar canadense': 'CAD',
    yen: 'JPY',
    euro: 'EUR',
    libra: 'GBP',
    yuan: 'CNY',
    renminbi: 'CNY',
    bitcoin: 'BTC'
};

const COTACAO_ALL_CODES = ['USD', 'CAD', 'JPY', 'EUR', 'GBP', 'CNY', 'BTC'];

function isRateLimited(authorId) {
    if (!authorId) return false;

    const now = Date.now();
    const windowStart = now - COMMAND_WINDOW_MS;

    const history = commandHistoryByUser.get(authorId) || [];
    const recent = history.filter((ts) => ts >= windowStart);
    recent.push(now);
    commandHistoryByUser.set(authorId, recent);

    return recent.length > MAX_COMMANDS_PER_MINUTE;
}

class CommandHandler {
    constructor(auditLogger, oracleService) {
        this.auditLogger = auditLogger;
        this.oracleService = oracleService;
        this.client = null;
    }

    setClient(client) {
        this.client = client;
    }

    async handle(msg, chat) {
        const body = msg.body || '';
        if (!body.startsWith('/')) return;

        const [rawCommand, ...args] = body.trim().split(/\s+/);
        const command = String(rawCommand || '').toLowerCase();

        const authorId = getSenderId(msg);
        const knownCommands = ['/ban', '/adm', '/oraculo', '/sobre', '/ajuda', '/help', '/sticker', '/piada', '/proibir', '/rank', '/noticias', '/news', '/cotacao', '/check', '/books', '/livros' ];
        const isKnown = knownCommands.includes(command);
        if (isKnown && command !== '/rank') {
            try {
                const authorPhone = await this.getFromNumber(msg);
                await prisma.commandLog.create({
                    data: {
                        command,
                        args: args?.length ? JSON.stringify(args) : null,
                        chatId: chat?.id?._serialized || null,
                        chatName: chat?.name || null,
                        authorId: authorId || null,
                        phone: authorPhone || null,
                        messageId: msg.id?._serialized || msg.id?.id || null
                    }
                });
            } catch (err) {
                console.warn('Falha ao registrar comando:', err?.message || err);
            }
        }

        if (command === '/ban') {
            return this.handleBan(msg, chat);
        }

        if (command === '/adm') {
            return this.handleAdm(msg, chat);
        }

        if (command === '/oraculo') {
            return this.handleOraculo(msg, chat);
        }

        if (command === '/sobre') {
            return this.handleSobre(msg, chat);
        }

        if (command === '/ajuda' || command === '/help') {
            return this.handleAjuda(msg, chat);
        }

        if (command === '/sticker') {
            return this.handleSticker(msg, chat);
        }

        if (command === '/piada') {
            // return await msg.reply('📚 Antes de buscar o riso do outro, decidi decifrar a anatomia da alegria; pois quem se aventura no palco sem conhecer a alma da comédia, corre o risco de encontrar apenas o silêncio do próprio eco.');

            return this.handlePiada(msg, chat);
        }

        // if (command === '/youtube') { 
        //     return this.handleYouTube(msg, chat, args);
        // }

        if (command === '/proibir') {
            return this.handleProibir(msg, chat);
        }

        if (command === '/rank' ) {
            return this.handleEstatisticas(msg, chat, args);
        }

        if (command === '/cotacao') {
            return this.handleCotacao(msg, args);
        }

        if (command === '/check') {
            return this.handleCheck(msg, chat, args);
        }

        if (command === '/noticias' || command === '/news') {
            return this.handleNoticiasCommand(msg, this.client);
        }

        if (command === '/books' || command === '/livros') {
            return this.handleBooks(msg);
        }

        return await msg.reply('❌ Por que invocar um comando que nem o próprio bot reconhece? Use /ajuda e ilumine-se antes de tentar de novo.');
    }

    async handleCotacao(msg, args) {
        const hgKey = String(process.env.HG_KEY || '').trim();
        if (!hgKey) {
            console.error('HG_KEY não configurada no ambiente. Serviço /cotacao indisponível.');
            await msg.reply('❌ O serviço de cotação está fora do ar no momento.');
            return;
        }

        const rawParam = String(args?.join(' ') || '').trim().toLowerCase();
        const selectedCode = rawParam ? COTACAO_ALIASES[rawParam] : null;

        if (rawParam && !selectedCode) {
            await msg.reply(
                `❌ Parâmetro inválido para /cotacao.\n\nOpções disponíveis:\n- dollar\n- dollar canadense\n- yen\n- euro\n- libra\n- yuan ou renminbi\n- bitcoin`
            );
            return;
        }

        const now = Date.now();
        const nextAllowedAt = lastCotacaoRequestAt + COTACAO_COOLDOWN_MS;
        if (lastCotacaoRequestAt > 0 && now < nextAllowedAt) {
            const remainingMs = nextAllowedAt - now;
            const remainingSec = Math.ceil(remainingMs / 1000);
            const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
            const ss = String(remainingSec % 60).padStart(2, '0');
            await msg.reply(`⏳ Esse comando foi usado recentemente. Espere ${mm}:${ss} para tentar de novo.`);
            return;
        }

        lastCotacaoRequestAt = now;

        try {
            const response = await fetch(`https://api.hgbrasil.com/finance?fields=currencies&key=${encodeURIComponent(hgKey)}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            if (!payload?.valid_key) {
                console.error('HG API retornou valid_key=false para /cotacao.');
                await msg.reply('❌ O serviço de cotação está fora do ar no momento.');
                return;
            }

            const currencies = payload?.results?.currencies;
            if (!currencies || typeof currencies !== 'object') {
                throw new Error('Resposta sem currencies');
            }

            const formatBuy = (value) => {
                const num = Number(value);
                if (!Number.isFinite(num)) return 'indisponível';
                return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
            };

            const formatVariation = (value) => {
                const num = Number(value);
                if (!Number.isFinite(num)) return 'n/d';
                return `${num > 0 ? '+' : ''}${num.toFixed(3)}%`;
            };

            const codes = selectedCode ? [selectedCode] : COTACAO_ALL_CODES;
            const lines = codes
                .filter((code) => currencies[code])
                .map((code) => {
                    const item = currencies[code];
                    const emoji = COTACAO_EMOJI_BY_CODE[code] || '💱';
                    return `- ${emoji} ${COTACAO_LABEL_BY_CODE[code]}: compra ${formatBuy(item?.buy)} (variação ${formatVariation(item?.variation)})`;
                });

            if (!lines.length) {
                await msg.reply('❌ Não consegui obter as cotações agora. Tente novamente em instantes.');
                return;
            }

            const title = selectedCode ? `💱 Cotação de ${COTACAO_LABEL_BY_CODE[selectedCode]}` : '💱 Cotações disponíveis';
            await msg.reply([title, '', ...lines].join('\n'));
        } catch (err) {
            console.error('Erro no /cotacao:', err?.message || err);
            await msg.reply('❌ O serviço de cotação está fora do ar no momento.');
        }
    }

    async resolveCheckTarget(msg, chat, args) {
        const mentionIds = Array.isArray(msg?.mentionedIds) ? msg.mentionedIds.filter(Boolean) : [];
        if (mentionIds.length > 0) {
            return String(mentionIds[0]);
        }

        const raw = String(args?.join(' ') || '');
        const digits = raw.replace(/\D/g, '');
        if (digits) {
            const participants = Array.isArray(chat?.participants) ? chat.participants : [];
            const normalize = (value) => String(value || '').replace(/\D/g, '');
            const found = participants.find((p) => {
                const pid = p?.id?._serialized || p?.id?.user || '';
                const normalized = normalize(pid);
                return normalized === digits || normalized.endsWith(digits);
            });
            if (found?.id?._serialized) {
                return found.id._serialized;
            }
        }

        if (msg?.hasQuotedMsg) {
            const quoted = await msg.getQuotedMessage();
            const quotedAuthorId = getSenderId(quoted);
            if (quotedAuthorId) {
                return quotedAuthorId;
            }
        }

        return null;
    }

    async resolveBanTarget(msg, chat, args) {
        const mentionIds = Array.isArray(msg?.mentionedIds) ? msg.mentionedIds.filter(Boolean) : [];
        if (mentionIds.length > 0) {
            return String(mentionIds[0]);
        }

        const raw = String(args?.join(' ') || '');
        const digits = raw.replace(/\D/g, '');
        if (digits) {
            const participants = Array.isArray(chat?.participants) ? chat.participants : [];
            const normalize = (value) => String(value || '').replace(/\D/g, '');
            const found = participants.find((p) => {
                const pid = p?.id?._serialized || p?.id?.user || '';
                const normalized = normalize(pid);
                return normalized === digits || normalized.endsWith(digits);
            });
            if (found?.id?._serialized) {
                return found.id._serialized;
            }
        }

        if (msg?.hasQuotedMsg) {
            const quoted = await msg.getQuotedMessage();
            const quotedAuthorId = getSenderId(quoted);
            if (quotedAuthorId) {
                return quotedAuthorId;
            }
        }

        return null;
    }

    async handleCheck(msg, chat, args) {
        const chatId = chat?.id?._serialized || null;
        
        if (!(await this.isAdmin(msg, chat))) {
            await msg.reply('❌ Nem todos que sonham com poder estão prontos para exercê-lo. Apenas administradores podem usar este comando.');
            return;
        }
        
        if (!chatId) {
            await msg.reply('❌ Não consegui identificar o chat para consultar estatísticas.');
            return;
        }

        const targetAuthorId = await this.resolveCheckTarget(msg, chat, args);
        if (!targetAuthorId) {
            await msg.reply('❓ Use */check @usuario* para eu analisar as estatísticas do membro.');
            return;
        }

        const targetPhone = String(targetAuthorId).replace(/\D/g, '');
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const weekStart = new Date(now);
        const day = weekStart.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        weekStart.setDate(weekStart.getDate() + diff);
        weekStart.setHours(0, 0, 0, 0);
        const monthStart = new Date(now);
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const userWhere = targetPhone
            ? { OR: [{ authorId: targetAuthorId }, { phone: targetPhone }] }
            : { authorId: targetAuthorId };

        const [
            totalStats,
            dayBucket,
            weekBucket,
            monthBucket,
            imagesRemovedCount,
            commandsCount,
            topCommandGroup
        ] = await Promise.all([
            prisma.messageStats.findUnique({
                where: {
                    chatId_authorId: {
                        chatId,
                        authorId: targetAuthorId
                    }
                }
            }),
            prisma.messageStatsBucket?.findUnique({
                where: {
                    chatId_authorId_periodType_periodStart: {
                        chatId,
                        authorId: targetAuthorId,
                        periodType: 'day',
                        periodStart: dayStart
                    }
                }
            }),
            prisma.messageStatsBucket?.findUnique({
                where: {
                    chatId_authorId_periodType_periodStart: {
                        chatId,
                        authorId: targetAuthorId,
                        periodType: 'week',
                        periodStart: weekStart
                    }
                }
            }),
            prisma.messageStatsBucket?.findUnique({
                where: {
                    chatId_authorId_periodType_periodStart: {
                        chatId,
                        authorId: targetAuthorId,
                        periodType: 'month',
                        periodStart: monthStart
                    }
                }
            }),
            prisma.log.count({
                where: {
                    action: 'IMAGE_REMOVED',
                    chatId,
                    ...userWhere
                }
            }),
            prisma.commandLog.count({
                where: {
                    chatId,
                    ...userWhere
                }
            }),
            prisma.commandLog.groupBy({
                by: ['command'],
                where: {
                    chatId,
                    ...userWhere
                },
                _count: {
                    command: true
                },
                orderBy: {
                    _count: {
                        command: 'desc'
                    }
                },
                take: 1
            })
        ]);

        let mentionContact = null;
        if (this.client) {
            try {
                mentionContact = await this.client.getContactById(targetAuthorId);
            } catch (_) {}
        }
        const label = mentionContact?.number
            ? `@${mentionContact.number}`
            : targetPhone
                ? `@${targetPhone}`
                : `@${String(targetAuthorId).split('@')[0]}`;

        const topCommand = topCommandGroup?.[0]?.command || '(nenhum)';
        const topCommandCount = topCommandGroup?.[0]?._count?.command || 0;
        const lastMessageAt = totalStats?.updatedAt
            ? new Intl.DateTimeFormat('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'medium'
            }).format(new Date(totalStats.updatedAt))
            : 'sem registro';

        const text = [
            `📊 *Check de usuário*`,
            '',
            `👤 ${label}`,
            '',
            `💬 *Mensagens*`,
            `- Hoje: ${dayBucket?.messagesCount || 0}`,
            `- Semana: ${weekBucket?.messagesCount || 0}`,
            `- Mês: ${monthBucket?.messagesCount || 0}`,
            `- Geral: ${totalStats?.messagesCount || 0}`,
            `- Última mensagem: ${lastMessageAt}`,
            '',
            `🖼️ *Imagens removidas:* ${imagesRemovedCount}`,
            `⚙️ *Comandos usados:* ${commandsCount}`,
            `🏆 *Comando mais usado:* ${topCommand} (${topCommandCount}x)`
        ].join('\n');

        if (mentionContact) {
            await chat.sendMessage(text, { mentions: [targetAuthorId] });
            return;
        }

        await msg.reply(text);
    }

    async handleBan(msg, chat) {
        const authorId = getSenderId(msg);
        const [, ...args] = String(msg.body || '').trim().split(/\s+/);

        if (!(await this.isAdmin(msg, chat))) {
            await msg.reply('❌ Nem todos que sonham com poder estão prontos para exercê-lo. Apenas administradores podem usar este comando.');
            return;
        }

        const userToBan = await this.resolveBanTarget(msg, chat, args);
        if (!userToBan) {
            await msg.reply('❓ Para purificar este antro da tolice, responde à mensagem do alvo ou usa */ban @usuario* para indicar quem deve sair.');
            return;
        }

        try {
            const banStickerPath = path.join(__dirname, '..', 'storage', 'ban.webp');
            const stickerBuffer = await fs.readFile(banStickerPath);
            const stickerMedia = new MessageMedia('image/webp', stickerBuffer.toString('base64'), 'ban.webp');

            await chat.sendMessage(stickerMedia, {
                sendMediaAsSticker: true,
                stickerName: 'BootWhats',
                stickerAuthor: 'DevTeam'
            });

            // Da um respiro para o WhatsApp propagar a figurinha no grupo
            // antes da remocao do participante.
            await sleep(500);

            await chat.removeParticipants([userToBan]);
            const fromNumber = await this.getFromNumber(msg);
            await this.auditLogger?.log('BAN_EXECUTED', {
                chatId: chat?.id?._serialized,
                phone: fromNumber,
                authorId,
                targetId: userToBan,
                messageId: msg.id?._serialized || msg.id?.id,
                content: msg.body
            });
        } catch (err) {
            console.error(err);
            await msg.reply('❌ A lanterna falhou em encontrar o caminho da saída. O estorvo permanece entre nós, como uma mancha que não sai com água. Verificai se tendes o poder para tal ato ou se o destino decidiu que ainda deveis suportar a presença deste bípede sem penas.');
        }
    }

    async handleAdm(msg, chat) {
        const participants = Array.isArray(chat?.participants) ? chat.participants : [];
        if (!participants.length) {
            await msg.reply('❌ Este comando so funciona em grupos onde eu consiga ver os participantes.');
            return;
        }

        const clientId = this.client?.info?.wid?._serialized || null;
        const adminIds = participants
            .filter((participant) => participant?.isAdmin || participant?.isSuperAdmin)
            .map((participant) => participant?.id?._serialized)
            .filter((id) => id && id !== clientId)
            .filter(Boolean);

        if (!adminIds.length) {
            await msg.reply('❌ Nao encontrei administradores neste grupo.');
            return;
        }

        const mentions = adminIds.map((id) => `@${String(id).split('@')[0]}`);
        const text = [
            '🚨 *ATENCAO* 🚨',
            '',
            'Administradores do grupo, sua presenca foi solicitada.',
            mentions.join(' ')
        ].join('\n');

        await msg.reply(text, undefined, { mentions: adminIds });
    }

    async isAdmin(msg, chat) {
        const author = await msg.getContact();
        const authorKey = author.number;
        const groupParticipants = chat.participants;
        const normalize = (id) => String(id || '').replace(/\D/g, '');
        msg._authorPhone = authorKey;
        return groupParticipants.some((participant) => {
            const participantKey = normalize(participant?.id?._serialized || participant?.id?.user);
            return participantKey && participantKey === authorKey && (participant.isAdmin || participant.isSuperAdmin);
        });
    }

    async getFromNumber(msg) {
        if (msg._authorPhone) {
            return msg._authorPhone;
        }
        const author = await msg.getContact();
        msg._authorPhone = author.number;
        return msg._authorPhone
    }

    async fetchGNewsArticles() {
        const apiKey = String(process.env.GNEWS_API_KEY || '').trim();
        if (!apiKey) {
            return { error: 'missing_key' };
        }

        const endpoint = `https://gnews.io/api/v4/top-headlines?category=general&lang=pt&country=br&max=5&apikey=${encodeURIComponent(apiKey)}`;
        try {
            const res = await fetch(endpoint, { method: 'GET' });
            if (!res.ok) {
                console.error(res)
                return { error: 'http_error' };
            }
            const data = await res.json();
            const articles = Array.isArray(data?.articles) ? data.articles : [];
            return { articles };
        } catch (err) {
            console.error(err)
            return { error: 'network_error' };
        }
    }

    sanitizeDescription(text, maxLen = 280) {
        if (!text) return '';
        const clean = String(text)
            .replace(/\s+/g, ' ')
            .replace(/\u0000/g, '')
            .trim();
        if (clean.length <= maxLen) return clean;
        return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
    }

    isValidUrl(value) {
        try {
            const url = new URL(String(value));
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (e) {
            return false;
        }
    }

    getLastMondayDate(baseDate = new Date()) {
        const date = new Date(baseDate);
        date.setHours(0, 0, 0, 0);
        const day = date.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        date.setDate(date.getDate() + diff);
        return date;
    }

    formatDateToIso(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    decodeHtmlEntities(text) {
        return String(text || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#34;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
    }

    normalizeText(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    htmlToCleanLines(html) {
        const text = this.decodeHtmlEntities(
            String(html || '')
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
                .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|tr|td)>/gi, '\n')
                .replace(/<[^>]+>/g, '\n')
        );

        return text
            .split('\n')
            .map((line) => this.normalizeText(line))
            .filter(Boolean);
    }

    extractWeeklyBooksFromPublishNews(html, limit = Number.POSITIVE_INFINITY) {
        const matches = String(html || '').match(/<div[^>]*class=["'][^"']*pn-ranking-livro-nome[^"']*["'][^>]*>[\s\S]*?<\/div>/gi) || [];
        const books = [];

        for (const match of matches) {
            const normalizedTitle = this.normalizeText(
                this.decodeHtmlEntities(String(match).replace(/<[^>]+>/g, ' '))
            );
            if (!normalizedTitle) continue;
            if (books.includes(normalizedTitle)) continue;

            books.push(normalizedTitle);
            if (books.length >= limit) break;
        }

        return books;
    }

    async fetchWeeklyBooksFromPublishNews(weekDate) {
        const weekIso = this.formatDateToIso(weekDate);
        const url = `https://www.publishnews.com.br/ranking-nielsen/semanal/0/${weekIso}/0/0`;
        const response = await fetch(url, {
            headers: {
                'user-agent': 'Mozilla/5.0 BootWhats/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ao buscar ranking semanal`);
        }

        const html = await response.text();
        const books = this.extractWeeklyBooksFromPublishNews(html, 3);
        if (!books.length) {
            throw new Error('Nenhum livro foi encontrado no ranking semanal');
        }

        return books;
    }

    async ensureWeeklyBooks(weekDate) {
        const existing = await prisma.bookTopWeek.findMany({
            where: { week: weekDate },
            orderBy: { id: 'asc' }
        });

        if (existing.length > 0) {
            return existing;
        }

        const books = await this.fetchWeeklyBooksFromPublishNews(weekDate);
        await prisma.bookTopWeek.createMany({
            data: books.map((book) => ({
                week: weekDate,
                book
            })),
            skipDuplicates: true
        });

        return prisma.bookTopWeek.findMany({
            where: { week: weekDate },
            orderBy: { id: 'asc' }
        });
    }

    async handleBooks(msg) {
        if (!prisma.bookTopWeek || !prisma.booksDownload || !prisma.bookRecomendation) {
            await msg.reply('❌ O módulo de livros ainda não está disponível. Rode as migrations e regenere o Prisma Client.');
            return;
        }

        try {
            const lastMonday = this.getLastMondayDate();
            const weeklyBooks = await this.ensureWeeklyBooks(lastMonday);

            const [downloads, recomendation] = await Promise.all([
                prisma.booksDownload.findMany({
                    where: { active: true },
                    orderBy: { id: 'asc' }
                }),
                prisma.bookRecomendation.findFirst({
                    orderBy: { createdAt: 'desc' }
                })
            ]);

            const lines = [
                `📚 *Livros da semana*`,
                `🗓️ Semana de ${new Intl.DateTimeFormat('pt-BR').format(lastMonday)}`,
                '',
                `📖 *Biblioteca virtual*`
            ];

            if (downloads.length > 0) {
                lines.push(...downloads.map((item) => `- ${this.normalizeText(item.font)}: ${this.normalizeText(item.link)}`));
            } else {
                lines.push('- Nenhuma fonte ativa cadastrada.');
            }

            lines.push('', '🏆 *Top livros da semana*');
            if (weeklyBooks.length > 0) {
                lines.push(...weeklyBooks.map((item, index) => `${index + 1}. ${this.normalizeText(item.book)}`));
            } else {
                lines.push('- Nenhum livro encontrado para a semana.');
            }

            lines.push('', '🧠 *Recomendação do Dio*');
            if (recomendation) {
                lines.push(`- ${this.normalizeText(recomendation.book)} | ${this.normalizeText(recomendation.autoctor)}`);
                lines.push(this.normalizeText(recomendation.description));
            } else {
                lines.push('- Nenhuma recomendação cadastrada.');
            }

            await msg.reply(lines.join('\n'));
        } catch (err) {
            console.error('Erro no /books:', err?.message || err);
            await msg.reply('❌ Não consegui montar a lista de livros agora.');
        }
    }

    async handleNoticiasCommand(msg, client) {
        const authorId = getSenderId(msg);
        if (!authorId) {
            await msg.reply('❌ Não foi possível identificar o usuário.');
            return;
        }

        const now = Date.now();
        const lastTs = lastNewsRequestByUser.get(authorId);
        if (lastTs) {
            const elapsed = now - lastTs;
            if (elapsed < NEWS_COOLDOWN_MS) {
                const remainingMs = NEWS_COOLDOWN_MS - elapsed;
                const remainingMin = Math.ceil(remainingMs / 60_000);
                await msg.reply(`⏳ Aguarde ${remainingMin} minutos antes de pedir notícias novamente.`);
                return;
            }
        }

        const { articles, error } = await this.fetchGNewsArticles();
        if (error) {
            await msg.reply('❌ Não foi possível buscar as notícias no momento.');
            return;
        }

        if (!articles || articles.length === 0) {
            await msg.reply('⚠️ Nenhuma notícia encontrada.');
            return;
        }

        lastNewsRequestByUser.set(authorId, now);

        // const firstImage = articles[0]?.image;
        // if (firstImage && this.isValidUrl(firstImage)) {
        //     try {
        //         const media = await MessageMedia.fromUrl(firstImage, { unsafeMime: true });
        //         if (media) {
        //             await msg.reply(media);
        //         }
        //     } catch (e) {
        //         // ignora falha ao enviar imagem
        //     }
        // }

        const header = '🗞️ Principais notícias do dia';
        const lines = [header, ''];
        const max = Math.min(5, articles.length);

        for (let i = 0; i < max; i += 1) {
            const item = articles[i] || {};
            const title = String(item.title || 'Sem título').trim();
            const description = this.sanitizeDescription(item.description, 280);
            const sourceName = String(item?.source?.name || 'Fonte desconhecida').trim();
            const url = this.isValidUrl(item.url) ? item.url : '';

            lines.push(`${i + 1}️⃣ ${title}`);
            if (description) lines.push(`📰 ${description}`);
            lines.push(`🌐 ${sourceName}`);
            if (url) lines.push(`🔗 ${url}`);
            if (i < max - 1) lines.push('');
        }

        await msg.reply(lines.join('\n'));
    }


    async handleProibir(msg, chat) {
        if (!(await this.isAdmin(msg, chat))) {
            await msg.reply('❌ Apenas administradores podem usar este comando.');
            return;
        }

        console.log(msg._authorPhone);

        if (!msg.hasQuotedMsg) {
            await msg.reply('❓ Responda a uma figurinha ou imagem com /proibir para bloquear o conteúdo.');
            return;
        }

        const quotedMsg = await msg.getQuotedMessage();
        if (!quotedMsg?.hasMedia) {
            await msg.reply('❌ A mensagem respondida não tem mídia.');
            return;
        }

        const media = await quotedMsg.downloadMedia();
        if (!media) {
            await msg.reply('❌ Não consegui baixar a mídia.');
            return;
        }

        const bufferOriginal = Buffer.from(media.data, 'base64');
        const md5 = require('node:crypto').createHash('md5').update(bufferOriginal).digest('hex');
        const authorId = getSenderId(msg);

        await prisma.mediaHash.upsert({
            where: { md5 },
            create: { md5, isNsfw: true },
            update: { isNsfw: true }
        });

        try {
            const evidencePath = await saveEvidence(bufferOriginal, {
                messageId: quotedMsg.id?._serialized || quotedMsg.id?.id,
                mimetype: media?.mimetype,
                evidenceDir: process.env.NSFW_EVIDENCE_DIR
            });
            await quotedMsg.delete(true);
            const authorPhone = await this.getFromNumber(msg);
            await this.auditLogger?.log('IMAGE_BLOCKED', {
                chatId: chat?.id?._serialized,
                phone: authorPhone,
                authorId,
                messageId: msg.id?._serialized || msg.id?.id,
                content: msg.caption || null,
                details: {
                    evidencePath
                }
            });
        } catch (err) {
            console.warn('Falha ao apagar mídia proibida:', err?.message || err);
        }

        

        await msg.reply('✅ Conteúdo proibido e registrado.');
    }

    async handleOraculo(msg, chat) {
        if (!this.oracleService) {
            await msg.reply('❌ Queres ouvir o oráculo, mas nem acendeu o fogo do templo.');
            return;
        }

        await this.oracleService.getWeeklyPrediction(msg, chat);
    }

    async handleEstatisticas(msg, chat, args) {
        const raw = String(args?.[0] || '').toLowerCase().trim();
        const mode = raw === 'diario' || raw === 'daily' ? 'day'
            : raw === 'semanal' || raw === 'weekly' ? 'week'
                : raw === 'mensal' || raw === 'monthly' ? 'month'
                    : null;
        const now = new Date();

        const attributeKey = mode === 'day'
            ? 'diario'
            : mode === 'month'
                ? 'mensal'
                : mode === 'week'
                    ? 'semanal'
                    : 'sem_atributo';

        if (mode === 'month' && now.getDate() < 25) {
            await msg.reply('❌ O /rank mensal só pode ser usado depois do dia 25.');
            return;
        }

        if (mode === 'day' && now.getHours() < 19) {
            await msg.reply('❌ O /rank diario só pode ser usado depois das 19h.');
            return;
        }

        const rateLimitedAttributes = new Set(['mensal', 'diario', 'sem_atributo']);
        if (rateLimitedAttributes.has(attributeKey)) {
            const windowStart = new Date(now.getTime() - 30 * 60 * 1000);

            const recentLogs = await prisma.commandLog.findMany({
                where: {
                    command: '/rank',
                    chatId: chat?.id?._serialized || null,
                    createdAt: { gte: windowStart }
                },
                orderBy: { createdAt: 'desc' },
                take: 50
            });

            const parseArgs = (value) => {
                if (!value) return [];
                try {
                    const parsed = JSON.parse(value);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (_) {
                    return [];
                }
            };

            const toAttributeKey = (argsList) => {
                const first = String(argsList?.[0] || '').toLowerCase().trim();
                if (first === 'diario' || first === 'daily') return 'diario';
                if (first === 'mensal' || first === 'monthly') return 'mensal';
                if (first === 'semanal' || first === 'weekly') return 'semanal';
                return 'sem_atributo';
            };

            const lastSame = recentLogs.find((log) => toAttributeKey(parseArgs(log.args)) === attributeKey);
            if (lastSame?.createdAt) {
                const nextAllowed = new Date(new Date(lastSame.createdAt).getTime() + 30 * 60 * 1000);
                const hh = String(nextAllowed.getHours()).padStart(2, '0');
                const mm = String(nextAllowed.getMinutes()).padStart(2, '0');
                await msg.reply(`⏳ O /rank ${attributeKey.replace('_', ' ')} só pode ser usado a cada 30 minutos. Tente novamente às ${hh}:${mm}.`);
                return;
            }
        }

        let periodStart = null;
        if (mode === 'day') {
            periodStart = new Date();
            periodStart.setHours(0, 0, 0, 0);
        } else if (mode === 'week') {
            periodStart = new Date();
            const day = periodStart.getDay(); // 0=Dom, 1=Seg, ...
            const diff = day === 0 ? -6 : 1 - day; // segunda como início da semana
            periodStart.setDate(periodStart.getDate() + diff);
            periodStart.setHours(0, 0, 0, 0);
        } else if (mode === 'month') {
            periodStart = new Date();
            periodStart.setDate(1);
            periodStart.setHours(0, 0, 0, 0);
        }

        const whereBase = { chatId: chat?.id?._serialized };
        const statsSource = mode
            ? prisma.messageStatsBucket
            : prisma.messageStats;

        if (!statsSource) {
            await msg.reply('❌ Estatísticas ainda não estão disponíveis. Rode as migrations e tente novamente.');
            return;
        }

        const where = mode
            ? { ...whereBase, periodType: mode, periodStart }
            : whereBase;

        try {
            const authorId = getSenderId(msg);
            const authorPhone = await this.getFromNumber(msg);
            await prisma.commandLog.create({
                data: {
                    command: '/rank',
                    args: args?.length ? JSON.stringify(args) : null,
                    chatId: chat?.id?._serialized || null,
                    chatName: chat?.name || null,
                    authorId: authorId || null,
                    phone: authorPhone || null,
                    messageId: msg.id?._serialized || msg.id?.id || null
                }
            });
        } catch (err) {
            console.warn('Falha ao registrar /rank:', err?.message || err);
        }

        const [topMessages, topCommands] = await Promise.all([
            statsSource.findMany({
                where,
                orderBy: { messagesCount: 'desc' },
                take: 5
            }),
            statsSource.findMany({
                where,
                orderBy: { commandsCount: 'desc' },
                take: 5
            })
        ]);

        const uniqueIds = new Set([
            ...topMessages.map((s) => s.authorId),
            ...topCommands.map((s) => s.authorId)
        ]);

        const labelById = new Map();
        if (this.client) {
            for (const id of uniqueIds) {
                try {
                    const contact = await this.client.getContactById(id);
                    if (contact) {
                        const label = contact?.pushname || contact?.name || contact?.number || id.split('@')[0];
                        labelById.set(id, label);
                    }
                } catch (e) {
                    // Ignora falhas individuais
                }
            }
        }

        const fmt = (list, countKey) => {
            if (!list.length) return ['(sem dados)'];
            return list.map((s, i) => {
                const label = labelById.get(s.authorId) || s.phone || String(s.authorId).split('@')[0];
                return `${i + 1}. ${label} — ${s[countKey] || 0}`;
            });
        };

        const title = mode === 'day'
            ? 'Top 5 do dia'
            : mode === 'week'
                ? 'Top 5 da semana'
                : mode === 'month'
                    ? 'Top 5 do mês'
                    : 'Top 5 gerais';

        const text = [
            `📊 *${title}*`,
            '',
            '🏆 *Quem mais fala:*',
            ...fmt(topMessages, 'messagesCount'),
            '',
            '⚡ *Quem mais me usa:*',
            ...fmt(topCommands, 'commandsCount')
        ].join('\n');

        await msg.reply(text);
    }

    async handleSobre(msg, _chat) {
        const text =
`🤖 *Sobre o bot*

Diogenes foi criado por um unico programador, com o orçamento de meio sanduiche de presunto, em um tempo muito curto e esta hospedado num pc do milhão.
Então falhs podem e irão acontecer, ao encotra-las avise que iremos chicotear o programador até ele corrigir ou morrer tentanto, 
para mais informacoes contatar devteam@devteam.net.br ou 11-994634-2101.
Caso queira ajudar para continuação do projeto, qulquer ajuda é bem vinda:
pix@diogenes.ia.br
_versão: 2.7.1_`;

        await msg.reply(text);
    }

    async handleAjuda(msg, _chat) {
        const text =
`📖 *Lista de comandos disponíveis*

- 🔨 */ban*  
  Apenas administradores. Use respondendo uma mensagem ou com */ban @usuario* para remover o usuário do grupo.

- 🚨 */adm*  
  Marca todos os administradores do grupo, o uso indevido desse comando é passivel de punições.

- 🚫 */proibir*  
  Apenas administradores. Responda uma imagem ou figurinha com /proibir para bloquear o conteúdo.

- 🔮 */oraculo*  
  Consulta o oráculo místico e retorna sua previsão da semana.

- 😂 */piada*  
  Envia uma piada aleatória do bot.

- 🖼️ */sticker*  
  Responda uma imagem/GIF com /sticker para o bot transformar em figurinha.

- 📊 */rank*  
  Exibe top 5 mensagens e comandos. Opcional: 'diario', 'semanal' ou 'mensal'.

- 🗞️ */noticias* ou */news*  
  Mostra até 5 notícias principais do dia.

- 💱 */cotacao*  
  Mostra cotações em BRL. Opções: 'dollar', 'dollar canadense', 'yen', 'euro', 'libra', 'yuan/renminbi' e 'bitcoin'. Sem parâmetro, retorna todas.

- 🕵️ */check*  
  Mostra estatísticas de um usuário mencionado: mensagens (hoje/semana/mês/geral), imagens removidas e uso de comandos.

- 📚 */books* ou */livros*  
  Exibe links ativos da biblioteca virtual, o top de livros da última segunda-feira e a recomendação mais recente do Dio.

- ℹ️ */sobre*  
  Mostra um resumo sobre o bot e quem desenvolveu.

- ❓ */ajuda ou /help*  
  Exibe esta lista de comandos.`;

        await msg.reply(text);
    }

    async handleSticker(msg, chat) {
        if (!msg.hasQuotedMsg) {
            await msg.reply('🖼️ Para criar uma figurinha, responda uma *imagem* ou *GIF/vídeo curto* com o comando */sticker*.');
            return;
        }

        const quotedMsg = await msg.getQuotedMessage();

        if (!quotedMsg?.hasMedia) {
            await msg.reply('❌ Queres figurinha do nada, como quem pede sombra sem sol. Responda uma imagem ou GIF/vídeo curto e use */sticker*.');
            return;
        }

        try {
            const media = await quotedMsg.downloadMedia();
            if (!media) {
                await msg.reply('❌ Até a arte precisa de matéria-prima. Não consegui baixar a mídia para criar a figurinha. Tente novamente.');
                return;
            }

            let stickerMedia = media;
            const mime = (media.mimetype || '').toLowerCase();

            // Para imagens, normaliza para WEBP 512x512 (padrão de sticker)
            if (mime.startsWith('image/')) {
                const inputBuffer = Buffer.from(media.data, 'base64');
                const webpBuffer = await sharp(inputBuffer, { animated: true })
                    .resize(512, 512, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .webp({ quality: 80 })
                    .toBuffer();

                stickerMedia = new MessageMedia('image/webp', webpBuffer.toString('base64'), 'sticker.webp');
            }

            await chat.sendMessage(stickerMedia, {
                sendMediaAsSticker: true,
                stickerName: 'BootWhats',
                stickerAuthor: 'DevTeam'
            });
        } catch (err) {
            console.error('Erro ao gerar sticker:', err);
            await msg.reply('❌      ');
        }
    }

    async handlePiada(msg, _chat) {
        try {
            const jokeModel = prisma?.joke;
            const hasModelApi = jokeModel && typeof jokeModel.count === 'function' && typeof jokeModel.findMany === 'function';

            const total = hasModelApi
                ? await jokeModel.count()
                : Number((await prisma.$queryRaw`SELECT COUNT(*) AS total FROM jokes`)[0]?.total || 0);

            if (!total) {
                await msg.reply('😕 Numa cidade cheia de tolos, faltam-me justamente as piadas. ');
                return;
            }

            const randomIndex = Math.floor(Math.random() * total);
            const joke = hasModelApi
                ? (await jokeModel.findMany({ skip: randomIndex, take: 1 }))[0]
                : (await prisma.$queryRaw`SELECT id, text FROM jokes LIMIT 1 OFFSET ${randomIndex}`)[0];

            if (!joke) {
                await msg.reply('😕 Até o humor, às vezes, foge da praça.');
                return;
            }

            await msg.reply(`😂 *Piada  do tio Dio (#${joke.id})*\n\n${joke.text}`);
        } catch (err) {
            console.error('Erro ao buscar piada:', err);
            await msg.reply('❌ Nem sempre a graça obedece ao clique. Não consegui buscar uma piada agora, tente novamente em alguns instantes.');
        }
    }

    async handleYouTube(msg, chat, args) {
        const url = args[0];

        if (!url) {
            await msg.reply('❌ Queres um vídeo sem apontar o caminho. Envie algo como: /youtube https://youtu.be/algum_video_curto');
            return;
        }

        if (!ytdl.validateURL(url)) {
            await msg.reply('❌ Até Diógenes reconheceria um caminho torto: este não parece ser um link válido do YouTube.');
            return;
        }

        const execFileAsync = promisify(execFile);
        const tmpName = `yt_${Date.now()}.mp4`;
        const tmpPath = path.join(os.tmpdir(), tmpName);

        try {
            await execFileAsync('yt-dlp', [
                '--no-playlist',
                '--match-filter',
                'duration <= 120',
                '--max-filesize',
                '16M',
                '-f',
                'mp4',
                '-o',
                tmpPath,
                url
            ]);

            const buffer = await fs.readFile(tmpPath);
            const maxBytes = 16 * 1024 * 1024; // ~16MB
            if (buffer.length > maxBytes) {
                await msg.reply('📦 O vídeo que trouxeste pesa mais do que esta ágora suporta. Tente um link mais curto ou leve.');
                return;
            }

            const media = new MessageMedia('video/mp4', buffer.toString('base64'), 'video.mp4');
            await chat.sendMessage(media, { sendVideoAsDocument: false });
        } catch (err) {
            if (err?.code === 'ENOENT') {
                await msg.reply('❌ yt-dlp não está instalado no servidor. Instale e tente novamente.');
                return;
            }
            console.error('Erro ao baixar vídeo do YouTube:', err);
            await msg.reply('❌ Até os bytes se rebelam às vezes. Não consegui trazer este vídeo do YouTube; tente outro link ou tente mais tarde.');
        } finally {
            try {
                await fs.unlink(tmpPath);
            } catch (_) {}
        }
    }
}

module.exports = CommandHandler;
