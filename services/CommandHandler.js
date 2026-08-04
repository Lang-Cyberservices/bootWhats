const { getSenderId } = require('./messageUtils');
const { siglaToFlagEmoji, extractSiglaFromFlagEmoji } = require('./countryUtils');
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
const COMMAND_WINDOW_MS = 2 * 60_000;
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
const HOROSCOPE_SIGN_MAP = {
    aries: { slug: 'aries', label: 'Áries', emoji: '♈' },
    touro: { slug: 'touro', label: 'Touro', emoji: '♉' },
    gemeos: { slug: 'gemeos', label: 'Gêmeos', emoji: '♊' },
    cancer: { slug: 'cancer', label: 'Câncer', emoji: '♋' },
    leao: { slug: 'leao', label: 'Leão', emoji: '♌' },
    virgem: { slug: 'virgem', label: 'Virgem', emoji: '♍' },
    libra: { slug: 'libra', label: 'Libra', emoji: '♎' },
    escorpiao: { slug: 'escorpiao', label: 'Escorpião', emoji: '♏' },
    sagitario: { slug: 'sagitario', label: 'Sagitário', emoji: '♐' },
    capricornio: { slug: 'capricornio', label: 'Capricórnio', emoji: '♑' },
    aquario: { slug: 'aquario', label: 'Aquário', emoji: '♒' },
    peixes: { slug: 'peixes', label: 'Peixes', emoji: '♓' }
};

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

function normalizeCommandText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

class CommandHandler {
    constructor(auditLogger, oracleService, diceRoller = null, forcaGame = null) {
        this.auditLogger = auditLogger;
        this.oracleService = oracleService;
        this.diceRoller = diceRoller;
        this.forcaGame = forcaGame;
        this.client = null;
        this.getBotReadyAt = null;
        this.userIdsCache = new Map();
    }

    setClient(client) {
        this.client = client;
    }

    setBotReadyAt(fn) {
        this.getBotReadyAt = fn;
    }

    isProtocolTimeoutError(err) {
        const message = String(err?.message || err || '');
        return err?.name === 'ProtocolError' && message.includes('timed out');
    }

    decodeMediaBuffer(media) {
        const rawData = typeof media?.data === 'string' ? media.data.trim() : '';
        if (!rawData) return null;

        try {
            const buffer = Buffer.from(rawData, 'base64');
            return buffer.length ? buffer : null;
        } catch (_) {
            return null;
        }
    }

    isUnsupportedImageError(err) {
        const message = String(err?.message || err || '').toLowerCase();
        return message.includes('unsupported image format');
    }

    async safeReply(msg, text) {
        try {
            await msg.reply(text);
            return true;
        } catch (replyErr) {
            console.error('Falha ao enviar resposta de fallback:', replyErr);
            return false;
        }
    }

    serializeWhatsAppId(value) {
        if (!value) return null;
        if (typeof value === 'string') return value;
        if (typeof value === 'object') {
            if (typeof value._serialized === 'string') return value._serialized;
            if (typeof value.id === 'string') return value.id;
            if (typeof value.user === 'string' && typeof value.server === 'string') {
                return `${value.user}@${value.server}`;
            }
        }
        return null;
    }

    // Resolve um ID (@c.us ou @lid) para as duas identidades do usuario.
    // Grupos migrados para LID listam participantes como NNNN@lid, entao
    // comparar so o telefone deixou de funcionar.
    async resolveUserIds(userId) {
        const serialized = this.serializeWhatsAppId(userId);
        if (!serialized) return null;

        if (this.userIdsCache.has(serialized)) {
            return this.userIdsCache.get(serialized);
        }

        try {
            if (this.client) {
                const [entry] = await this.client.getContactLidAndPhone([serialized]);
                if (entry?.lid || entry?.pn) {
                    const result = { lid: entry.lid || null, pn: entry.pn || null };
                    this.userIdsCache.set(serialized, result);
                    return result;
                }
            }
        } catch (err) {
            // Nao cacheia falha: pode ser transitoria (pagina ainda carregando).
            console.warn('Falha ao resolver LID/telefone de', serialized, '-', err?.message || err);
        }

        return null;
    }

    findParticipantIdByDigits(chat, digits) {
        if (!digits) return null;

        const participants = Array.isArray(chat?.participants) ? chat.participants : [];
        const normalize = (value) => String(value || '').replace(/\D/g, '');
        const found = participants.find((participant) => {
            const participantId = this.serializeWhatsAppId(participant?.id) || participant?.id?.user || '';
            const normalized = normalize(participantId);
            return normalized === digits || normalized.endsWith(digits);
        });

        return this.serializeWhatsAppId(found?.id);
    }

    async findParticipantIdByDigitsLidAware(chat, idOrDigits) {
        const raw = String(idOrDigits || '');
        const digits = raw.replace(/\D/g, '');
        if (!digits) return null;

        const direct = this.findParticipantIdByDigits(chat, digits);
        if (direct) return direct;

        // Os digitos podem ser um telefone enquanto o grupo lista LIDs (ou vice-versa).
        const lookupId = raw.includes('@') ? raw : `${digits}@c.us`;
        const ids = await this.resolveUserIds(lookupId);
        for (const candidate of [ids?.lid, ids?.pn]) {
            const candidateDigits = String(candidate || '').replace(/\D/g, '');
            if (!candidateDigits || candidateDigits === digits) continue;
            const found = this.findParticipantIdByDigits(chat, candidateDigits);
            if (found) return found;
        }

        return null;
    }

    async handle(msg, chat) {
        const body = msg.body || '';
        if (!body.startsWith('/')) return;

        const [rawCommand, ...args] = body.trim().split(/\s+/);
        const command = String(rawCommand || '').toLowerCase();
        const diceCommandInfo = this.diceRoller?.extractExpression(body) || null;
        const canonicalCommand = diceCommandInfo?.isDiceCommand ? '/d' : command;
        const canonicalArgs = diceCommandInfo?.isDiceCommand
            ? [diceCommandInfo.expression].filter(Boolean)
            : args;

        const authorId = getSenderId(msg);
        const knownCommands = ['/ban', '/adm', '/oraculo', '/oráculo', '/sobre', '/ajuda', '/help', '/sticker', '/piada', '/proibir', '/rank', '/noticias', '/news', '/cotacao', '/check', '/books', '/livros', '/pergunta', '/bola8', '/8ball', '/horoscopo', '/horóscopo', '/signo', '/sorteio', '/d', '/definir', '/filme', '/forca', '/pais' ];
        const isKnown = knownCommands.includes(canonicalCommand);
        if (isKnown && isRateLimited(authorId)) {
            await msg.reply('⏳ Espere um pouco antes de usar mais comandos para não floodar.');
            return;
        }

        if (isKnown && command !== '/rank') {
            try {
                const authorPhone = await this.getFromNumber(msg);
                await prisma.commandLog.create({
                    data: {
                        command: canonicalCommand,
                        args: canonicalArgs?.length ? JSON.stringify(canonicalArgs) : null,
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

        if (command === '/oraculo' || command === '/oráculo') {
            return this.handleOraculo(msg, chat);
        }

        if (diceCommandInfo?.isDiceCommand) {
            return this.handleDice(msg, diceCommandInfo.expression);
        }

        if (command === '/horoscopo' || command === '/horóscopo' || command === '/signo') {
            return this.handleHoroscopo(msg, chat, args);
        }

        if (command === '/status') {
            return this.handleStatus(msg);
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

        if (command === '/definir') {
            return this.handleDefinir(msg, args);
        }

        if (command === '/noticias' || command === '/news') {
            return this.handleNoticiasCommand(msg, this.client);
        }

        if (command === '/books' || command === '/livros') {
            return this.handleBooks(msg);
        }

        if (command === '/pergunta' || command === '/bola8' || command === '/8ball') {
            return this.handlePergunta(msg, chat, args);
        }

        if (command === '/sorteio') {
            return this.handleSorteio(msg, chat);
        }

        if (command === '/filme') {
            return this.handleFilme(msg, chat, args);
        }

        if (command === '/forca') {
            return this.handleForca(msg, chat, args);
        }

        if (command === '/pais') {
            return this.handlePais(msg, chat, args);
        }

        return await msg.reply('❌ Por que invocar um comando que nem o próprio bot reconhece? Use /ajuda e ilumine-se antes de tentar de novo.');
    }

    async handleDice(msg, expression) {
        if (!this.diceRoller) {
            await msg.reply('❌ O módulo de rolagem ainda não está disponível.');
            return;
        }

        try {
            const result = this.diceRoller.roll(expression);
            await msg.reply(result);
        } catch (err) {
            if (err?.name === 'DiceRollerError') {
                await msg.reply(err.message || '❌ Não consegui interpretar essa rolagem.');
                return;
            }
            console.error('Erro no /d:', err);
            await msg.reply('❌ Não consegui interpretar essa rolagem.');
        }
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
            const participantId = await this.findParticipantIdByDigitsLidAware(chat, digits);
            if (participantId) {
                return participantId;
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
            const mentionedId = this.serializeWhatsAppId(mentionIds[0]);
            if (mentionedId) {
                return mentionedId;
            }
        }

        const raw = String(args?.join(' ') || '');
        const digits = raw.replace(/\D/g, '');
        if (digits) {
            const participantId = await this.findParticipantIdByDigitsLidAware(chat, digits);
            if (participantId) {
                return participantId;
            }
        }

        if (msg?.hasQuotedMsg) {
            const quoted = await msg.getQuotedMessage();
            const quotedAuthorId = this.serializeWhatsAppId(getSenderId(quoted));
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
            const serializedTarget = this.serializeWhatsAppId(userToBan);
            const targetDigits = String(serializedTarget || userToBan || '').replace(/\D/g, '');
            // Prioriza o id como consta na lista de participantes (o grupo pode
            // usar @lid enquanto o alvo chegou como @c.us, ou o contrario).
            const normalizedTargetId = (await this.findParticipantIdByDigitsLidAware(chat, serializedTarget || targetDigits)) || serializedTarget;
            if (!normalizedTargetId) {
                await msg.reply('❌ Não consegui identificar corretamente o participante para remover.');
                return;
            }

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

            await chat.removeParticipants([normalizedTargetId]);
            const fromNumber = await this.getFromNumber(msg);
            await this.auditLogger?.log('BAN_EXECUTED', {
                chatId: chat?.id?._serialized,
                phone: fromNumber,
                authorId,
                targetId: normalizedTargetId,
                messageId: msg.id?._serialized || msg.id?.id,
                content: msg.body
            });
        } catch (err) {
            console.error(err);
            await msg.reply('❌ A lanterna falhou em encontrar o caminho da saída. O estorvo permanece entre nós, como uma mancha que não sai com água. Verificai se tendes o poder para tal ato ou se o destino decidiu que ainda deveis suportar a presença deste bípede sem penas.');
        }
    }

    async handleAdm(msg, chat) {
      await msg.reply('❌ Comando desativado.');
      return;


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

    // Reune todas as identidades conhecidas do autor (telefone e LID),
    // normalizadas para digitos, ja que o autor pode chegar como @c.us ou @lid.
    async collectAuthorIdentities(msg) {
        const identities = new Set();
        const add = (value) => {
            const digits = String(value || '').replace(/\D/g, '');
            if (digits) identities.add(digits);
        };

        const senderId = getSenderId(msg);
        add(senderId);
        add(msg?.author);

        let contact = null;
        try {
            contact = await msg.getContact();
        } catch (err) {
            console.warn('Falha ao obter contato do autor:', err?.message || err);
        }
        add(contact?.id?._serialized);
        add(contact?.number);

        const ids = await this.resolveUserIds(senderId || contact?.id?._serialized);
        add(ids?.lid);
        add(ids?.pn);

        const phoneDigits = String(ids?.pn || contact?.number || '').replace(/\D/g, '');
        if (phoneDigits) {
            msg._authorPhone = phoneDigits;
        }

        return identities;
    }

    async isAdmin(msg, chat) {
        const identities = await this.collectAuthorIdentities(msg);
        if (!identities.size) return false;

        const participants = Array.isArray(chat?.participants) ? chat.participants : [];
        return participants.some((participant) => {
            if (!participant?.isAdmin && !participant?.isSuperAdmin) return false;
            const participantKey = String(participant?.id?._serialized || participant?.id?.user || '').replace(/\D/g, '');
            return participantKey && identities.has(participantKey);
        });
    }

    async getFromNumber(msg) {
        if (msg._authorPhone) {
            return msg._authorPhone;
        }

        const senderId = getSenderId(msg);
        const ids = await this.resolveUserIds(senderId);
        let phone = String(ids?.pn || '').replace(/\D/g, '');

        if (!phone) {
            try {
                const author = await msg.getContact();
                phone = String(author?.number || '').replace(/\D/g, '');
            } catch (err) {
                console.warn('Falha ao obter contato do autor:', err?.message || err);
            }
        }

        if (phone) {
            msg._authorPhone = phone;
        }
        return phone || null;
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

    async fetchMovieResults(query) {
        const apiKey = String(process.env.THEMOVIEDB_API || '').trim();
        if (!apiKey) {
            return { error: 'missing_key' };
        }

        const endpoint = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(apiKey)}&language=pt-BR&query=${encodeURIComponent(query)}`;
        try {
            const res = await fetch(endpoint, { method: 'GET' });
            if (!res.ok) {
                console.error('Erro HTTP ao buscar filmes:', res.status);
                return { error: 'http_error' };
            }
            const data = await res.json();
            const results = Array.isArray(data?.results) ? data.results : [];
            return { results };
        } catch (err) {
            console.error('Erro de rede ao buscar filmes:', err);
            return { error: 'network_error' };
        }
    }

    async handleFilme(msg, chat, args) {
        const query = String(args?.join(' ') || '').trim();
        if (!query) {
            await msg.reply('🎬 Use */filme [nome do filme]*. Ex: /filme matrix');
            return;
        }

        try {
            const { results, error } = await this.fetchMovieResults(query);

            if (error === 'missing_key') {
                console.warn('THEMOVIEDB_API não configurada.');
                await msg.reply('❌ Busca de filmes indisponível no momento (configuração ausente).');
                return;
            }

            if (error) {
                await msg.reply('❌ Não consegui buscar filmes agora.');
                return;
            }

            if (!results || results.length === 0) {
                await msg.reply(`🔍 Nenhum filme encontrado para "${query}".`);
                return;
            }

            const topResults = results.slice(0, 3);

            if (results.length > 3) {
                await msg.reply(`🔍 Achei ${results.length} filmes para "${query}"... vou mostrar os 3 primeiros.`);
            }

            for (const movie of topResults) {
                const title = String(movie?.title || movie?.original_title || 'Sem título').trim();
                const originalTitle = String(movie?.original_title || '').trim();
                const year = String(movie?.release_date || '').slice(0, 4);
                const overview = this.sanitizeDescription(movie?.overview, 900) || 'Sem sinopse disponível.';

                const yearPart = /^\d{4}$/.test(year) ? ` (${year})` : '';
                const originalPart = originalTitle && originalTitle !== title ? ` (_${originalTitle}_)` : '';
                const lines = [`🎬 *${title}*${yearPart}${originalPart}`, '', overview];
                const caption = lines.join('\n');

                const imagePath = movie?.backdrop_path || movie?.poster_path;
                let media = null;
                if (imagePath) {
                    const size = movie?.backdrop_path ? 'w780' : 'w500';
                    const imageUrl = `https://image.tmdb.org/t/p/${size}${imagePath}`;
                    try {
                        media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                    } catch (err) {
                        console.error('Erro ao baixar capa do filme:', err?.message || err);
                        media = null;
                    }
                }

                try {
                    if (media) {
                        await chat.sendMessage(media, { caption });
                    } else {
                        await msg.reply(caption);
                    }
                } catch (err) {
                    console.error('Erro ao enviar resultado de filme:', err?.message || err);
                }
            }
        } catch (err) {
            console.error('Erro no /filme:', err?.message || err);
            await msg.reply('❌ Não consegui buscar filmes agora.');
        }
    }

    async handlePais(msg, chat, args) {
        const query = String(args?.join(' ') || '').trim();
        if (!query) {
            await msg.reply('🌍 Use */pais [nome do país ou bandeira]*. Ex: /pais brasil ou /pais 🇧🇷');
            return;
        }

        try {
            const sigla = extractSiglaFromFlagEmoji(query);

            let country = null;
            if (sigla) {
                country = await prisma.country.findUnique({ where: { sigla } });
            } else {
                const matches = await prisma.country.findMany({
                    where: { name: { contains: query } },
                    orderBy: { name: 'asc' },
                    take: 5
                });
                country = matches.find((c) => c.name.toLowerCase() === query.toLowerCase()) || matches[0] || null;
            }

            if (!country) {
                await msg.reply(`🔍 Não encontrei nenhum país para "${query}".`);
                return;
            }

            const flagEmoji = siglaToFlagEmoji(country.sigla);
            const description = this.sanitizeDescription(country.description, 1000) || 'Sem descrição disponível.';
            const text = `${flagEmoji} *${country.name}* ${flagEmoji}\n\n${description}`;

            await msg.reply(text);
        } catch (err) {
            console.error('Erro no /pais:', err?.message || err);
            await msg.reply('❌ Não consegui buscar o país agora.');
        }
    }

    async handleForca(msg, chat, args) {
        if (!this.forcaGame) {
            await msg.reply('❌ O jogo da forca ainda não está disponível.');
            return;
        }

        try {
            await this.forcaGame.startGame(msg, chat, args);
        } catch (err) {
            console.error('Erro no /forca:', err?.message || err);
            await msg.reply('❌ Não consegui iniciar o jogo da forca agora.');
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

        const bufferOriginal = this.decodeMediaBuffer(media);
        if (!bufferOriginal) {
            await msg.reply('❌ A mídia recebida veio inválida ou incompleta. Tente novamente com outra imagem ou figurinha.');
            return;
        }
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
                evidenceDir: process.env.NSFW_EVIDENCE_DIR,
                md5
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

    getHoroscopeDateInfo() {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const parts = formatter.formatToParts(new Date());
        const year = parts.find((part) => part.type === 'year')?.value;
        const month = parts.find((part) => part.type === 'month')?.value;
        const day = parts.find((part) => part.type === 'day')?.value;
        const iso = `${year}-${month}-${day}`;
        const display = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            dateStyle: 'full'
        }).format(new Date());

        return { iso, display };
    }

    resolveHoroscopeSign(rawValue) {
        const key = normalizeCommandText(rawValue).replace(/\s+/g, '');
        return HOROSCOPE_SIGN_MAP[key] || null;
    }

    listHoroscopeSigns() {
        return Object.values(HOROSCOPE_SIGN_MAP).map((item) => item.label).join(', ');
    }

    getHoroscopeSignInfo(signSlug) {
        return Object.values(HOROSCOPE_SIGN_MAP).find((item) => item.slug === signSlug) || null;
    }

    async getUserHoroscopeRecord(userId) {
        const rows = await prisma.$queryRaw`
            SELECT id, userId, phone, sign
            FROM user_horoscopes
            WHERE userId = ${userId}
            LIMIT 1
        `;
        return rows?.[0] || null;
    }

    async saveUserHoroscopeRecord({ userId, phone, sign }) {
        await prisma.$executeRaw`
            INSERT INTO user_horoscopes (userId, phone, sign, createdAt, updatedAt)
            VALUES (${userId}, ${phone || null}, ${sign}, NOW(3), NOW(3))
            ON DUPLICATE KEY UPDATE
                phone = VALUES(phone),
                sign = VALUES(sign),
                updatedAt = NOW(3)
        `;
    }

    async getDailyHoroscopeRecord(dateIso, sign) {
        const rows = await prisma.$queryRaw`
            SELECT id, date, sign, horoscope
            FROM daily_horoscopes
            WHERE date = ${dateIso} AND sign = ${sign}
            LIMIT 1
        `;
        return rows?.[0] || null;
    }

    async saveDailyHoroscopeRecord({ dateIso, sign, horoscope }) {
        await prisma.$executeRaw`
            INSERT INTO daily_horoscopes (date, sign, horoscope, createdAt, updatedAt)
            VALUES (${dateIso}, ${sign}, ${horoscope}, NOW(3), NOW(3))
            ON DUPLICATE KEY UPDATE
                horoscope = VALUES(horoscope),
                updatedAt = NOW(3)
        `;
    }

    extractFirstDivByClass(html, className) {
        const source = String(html || '');
        const classPattern = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'i');
        const startMatch = classPattern.exec(source);
        if (!startMatch || startMatch.index < 0) return null;

        const startIndex = startMatch.index;
        const openEnd = startIndex + startMatch[0].length;
        const tagPattern = /<\/?div\b[^>]*>/gi;
        tagPattern.lastIndex = openEnd;

        let depth = 1;
        let match;
        while ((match = tagPattern.exec(source))) {
            const token = match[0];
            if (/^<div\b/i.test(token)) {
                depth += 1;
            } else {
                depth -= 1;
                if (depth === 0) {
                    return source.slice(startIndex, tagPattern.lastIndex);
                }
            }
        }

        return null;
    }

    extractParagraphTextFromHtml(html) {
        const paragraphMatch = String(html || '').match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
        if (!paragraphMatch) return '';

        return this.normalizeText(
            this.decodeHtmlEntities(
                paragraphMatch[1]
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]+>/g, ' ')
            )
        );
    }

    async fetchHoroscopeFromUol(signSlug) {
        const url = `https://www.uol.com.br/universa/horoscopo/${signSlug}/horoscopo-do-dia/`;
        const response = await fetch(url, {
            headers: {
                'user-agent': 'Mozilla/5.0 BootWhats/1.0',
                'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
            }
        });

        if (!response.ok) {
            throw new Error(`UOL HTTP ${response.status}`);
        }

        const html = await response.text();
        const container = this.extractFirstDivByClass(html, 'horoscope-open-content');
        const horoscope = this.extractParagraphTextFromHtml(container);

        if (!horoscope) {
            throw new Error('Horóscopo não encontrado na página da UOL.');
        }

        return horoscope;
    }

    async getOrCreateDailyHoroscope(signSlug) {
        const { iso } = this.getHoroscopeDateInfo();
        const existing = await this.getDailyHoroscopeRecord(iso, signSlug);
        if (existing?.horoscope) {
            return String(existing.horoscope).trim();
        }

        const fetched = await this.fetchHoroscopeFromUol(signSlug);
        await this.saveDailyHoroscopeRecord({
            dateIso: iso,
            sign: signSlug,
            horoscope: fetched
        });
        return fetched;
    }

    formatHoroscopeMessage(signInfo, horoscope) {
        const { display } = this.getHoroscopeDateInfo();
        return [
            `${signInfo.emoji} *Horóscopo de ${signInfo.label}*`,
            `📅 ${display}`,
            '',
            horoscope,
            '',
            'Fonte: UOL'
        ].join('\n');
    }

    async handleHoroscopo(msg, _chat, args) {
        const userId = getSenderId(msg);
        if (!userId) {
            await msg.reply('❌ Não consegui identificar o usuário para consultar seu horóscopo.');
            return;
        }

        const rawSign = String(args?.join(' ') || '').trim();
        const phone = await this.getFromNumber(msg);

        try {
            let signInfo = null;

            if (rawSign) {
                signInfo = this.resolveHoroscopeSign(rawSign);
                if (!signInfo) {
                    await msg.reply(`❌ Signo inválido. Use um destes em português: ${this.listHoroscopeSigns()}.`);
                    return;
                }

                await this.saveUserHoroscopeRecord({
                    userId,
                    phone,
                    sign: signInfo.slug
                });
            } else {
                const userRecord = await this.getUserHoroscopeRecord(userId);
                if (!userRecord?.sign) {
                    await msg.reply(`❓ Você ainda não cadastrou seu signo. Use */horoscopo [signo]*. Opções: ${this.listHoroscopeSigns()}.`);
                    return;
                }

                signInfo = this.getHoroscopeSignInfo(String(userRecord.sign).trim());
                if (!signInfo) {
                    await msg.reply(`❌ Seu signo cadastrado está inválido. Use */horoscopo [signo]* para atualizar. Opções: ${this.listHoroscopeSigns()}.`);
                    return;
                }

                if (!userRecord.phone && phone) {
                    await this.saveUserHoroscopeRecord({
                        userId,
                        phone,
                        sign: signInfo.slug
                    });
                }
            }

            const horoscope = await this.getOrCreateDailyHoroscope(signInfo.slug);
            await msg.reply(this.formatHoroscopeMessage(signInfo, horoscope));
        } catch (err) {
            console.error('Erro no /horoscopo:', err);
            const errorMessage = String(err?.message || err || '').toLowerCase();
            if (errorMessage.includes('doesn\'t exist') || errorMessage.includes('does not exist') || errorMessage.includes('unknown table')) {
                await msg.reply('❌ O módulo de horóscopo ainda não está disponível. Rode as migrations e tente novamente.');
                return;
            }
            await msg.reply('❌ Não consegui consultar o horóscopo agora.');
        }
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

        const lines = [
            `📊 *${title}*`,
            '',
            '🏆 *Quem mais fala:*',
            ...fmt(topMessages, 'messagesCount'),
            '',
            '⚡ *Quem mais me usa:*',
            ...fmt(topCommands, 'commandsCount')
        ];

        if (!mode) {
            try {
                const topGameScores = await prisma.gameScore.findMany({
                    where: { chatId: chat?.id?._serialized, gameType: 'forca' },
                    orderBy: { totalPoints: 'desc' },
                    take: 5
                });

                if (topGameScores.length) {
                    lines.push('', '🎮 *Forca — pontuação:*');
                    for (const [i, score] of topGameScores.entries()) {
                        let label = labelById.get(score.authorId);
                        if (!label && this.client) {
                            try {
                                const contact = await this.client.getContactById(score.authorId);
                                label = contact?.pushname || contact?.name || contact?.number || null;
                            } catch (_) {}
                        }
                        label = label || String(score.authorId).split('@')[0];
                        lines.push(`${i + 1}. ${label} — ${score.totalPoints} pontos (${score.wins} vitórias)`);
                    }
                }
            } catch (err) {
                console.warn('Falha ao buscar pontuação de jogos para /rank:', err?.message || err);
            }
        }

        await msg.reply(lines.join('\n'));
    }

    async handleSobre(msg, _chat) {
        const text =
`🤖 *Sobre o bot*

Diogenes foi criado por um unico programador, com o orçamento de meio sanduiche de presunto, em um tempo muito curto e esta hospedado num pc do milhão.
Então falhas podem e irão acontecer, ao encotra-las avise que iremos chicotear o programador até ele corrigir ou morrer tentanto,
para mais informacoes contatar devteam@devteam.net.br ou 11-994634-2101.
Caso queira ajudar para continuação do projeto, qulquer ajuda é bem vinda:
pix@diogenes.ia.br
_versão: 3.1.0_`;

        await msg.reply(text);
    }

    async handleStatus(msg) {
        const readyAt = this.getBotReadyAt?.();

        let uptimeStr = 'indisponível';
        if (readyAt) {
            const totalSec = Math.floor((Date.now() - readyAt) / 1000);
            const d = Math.floor(totalSec / 86400);
            const h = Math.floor((totalSec % 86400) / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;
            const parts = [];
            if (d) parts.push(`${d}d`);
            if (h) parts.push(`${h}h`);
            if (m) parts.push(`${m}m`);
            parts.push(`${s}s`);
            uptimeStr = parts.join(' ');
        }

        const toMb = (b) => (b / 1024 / 1024).toFixed(0);
        const pct = (used, total) => ((used / total) * 100).toFixed(1);
        const rss = process.memoryUsage().rss;
        const totalRam = os.totalmem();
        const usedRam  = totalRam - os.freemem();

        let diskStr = 'indisponível';
        try {
            const stat = await fs.statfs('/');
            const bs = stat.bsize;
            const toGb = (b) => (b / 1024 / 1024 / 1024).toFixed(1);
            const totalDisk = stat.blocks * bs;
            const freeDisk  = stat.bfree  * bs;
            const usedDisk  = totalDisk - freeDisk;
            diskStr = `(${pct(usedDisk, totalDisk)}%)`;
        } catch (_) {}

        const [l1, l5, l15] = os.loadavg().map(v => v.toFixed(2));

        const text = [
            '🟢 *Status do bot*',
            '',
            `⏱ *Uptime:* ${uptimeStr}`,
            `🧠 *RAM processo:* ${toMb(rss)} MB`,
            `📊 *Uso RAM sistema:* (${pct(usedRam, totalRam)}%)`,
            `💾 *Uso disco:* ${diskStr}`,
            `⚙️ *CPU load:* ${l1} · ${l5} · ${l15} _(1/5/15 min)_`,
        ].join('\n');

        await msg.reply(text);
    }

    async handleAjuda(msg, _chat) {
        const text = '📖 Para ver a lista completa de comandos, acesse: https://www.diogenes.ia.br';
        await msg.reply(text);
    }

    async handlePergunta(msg, chat, args) {
        const question = String(args?.join(' ') || '').trim();

        if (!question) {
            await msg.reply('❓ Você precisa fazer uma pergunta depois do comando.');
            return;
        }

        const draw = Math.floor(Math.random() * 20) + 1;
        const imageName = String(draw).padStart(2, '0') + '.png';
        const imagePath = path.join(__dirname, '..', 'storage', 'bola8', imageName);

        try {
            const imageBuffer = await fs.readFile(imagePath);
            const media = new MessageMedia('image/png', imageBuffer.toString('base64'), imageName);

            await chat.sendMessage(media, {
                quotedMessageId: msg.id?._serialized
            });
        } catch (err) {
            console.error('Erro no /pergunta:', err);
            if (this.isProtocolTimeoutError(err)) {
                console.error('Envio do /pergunta ignorou o fallback porque a sessão do WhatsApp Web ficou sem responder.');
                return;
            }

            await this.safeReply(msg, '❌ Não consegui consultar a bola 8 agora.');
        }
    }

    async handleSorteio(msg, chat) {
        try {
            let quotedPoll = null;
            if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                if (quoted?.type === 'poll_creation') {
                    quotedPoll = quoted;
                }
            }

            let winnerId = null;
            let header = null;

            if (quotedPoll) {
                const votes = await quotedPoll.getPollVotes();
                const voterIds = [...new Set(
                    (votes || [])
                        .filter((vote) => Array.isArray(vote?.selectedOptions) && vote.selectedOptions.length > 0)
                        .map((vote) => this.serializeWhatsAppId(vote?.voter))
                        .filter(Boolean)
                )];

                if (!voterIds.length) {
                    await msg.reply('🗳️ Ninguém votou nessa enquete ainda. Sem participantes, não há destino a decidir.');
                    return;
                }

                winnerId = voterIds[Math.floor(Math.random() * voterIds.length)];
                const pollName = String(quotedPoll.body || '').trim();
                header = pollName
                    ? `🗳️ *Sorteio da enquete "${pollName}"*`
                    : '🗳️ *Sorteio da enquete*';
            } else {
                const clientId = this.client?.info?.wid?._serialized || null;
                const participantIds = (Array.isArray(chat?.participants) ? chat.participants : [])
                    .map((participant) => this.serializeWhatsAppId(participant?.id))
                    .filter((id) => id && id !== clientId);

                if (!participantIds.length) {
                    await msg.reply('❌ Este comando só funciona em grupos onde eu consiga ver os participantes.');
                    return;
                }

                winnerId = participantIds[Math.floor(Math.random() * participantIds.length)];
                header = '🎲 *Sorteio do grupo*';
            }

            let winnerContact = null;
            if (this.client) {
                try {
                    winnerContact = await this.client.getContactById(winnerId);
                } catch (_) {}
            }
            const label = winnerContact?.pushname
                || winnerContact?.name
                || winnerContact?.number
                || String(winnerId).split('@')[0];

            const text = [
                header,
                '',
                `🎉 O destino escolheu: *${label}*`
            ].join('\n');

            await msg.reply(text);
        } catch (err) {
            console.error('Erro no /sorteio:', err);
            await this.safeReply(msg, '❌ O destino se recusou a escolher alguém agora. Tente novamente.');
        }
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
                const inputBuffer = this.decodeMediaBuffer(media);
                if (!inputBuffer) {
                    await msg.reply('❌ A imagem citada veio inválida ou incompleta. Envie novamente e tente criar a figurinha.');
                    return;
                }

                try {
                    await sharp(inputBuffer, { animated: true }).metadata();
                } catch (err) {
                    if (this.isUnsupportedImageError(err)) {
                        await msg.reply('❌ Esse arquivo de imagem não é compatível para virar figurinha. Tente outra mídia.');
                        return;
                    }
                    throw err;
                }

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
            await msg.reply('❌ Não consegui gerar a figurinha com essa mídia.');
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

    async handleDefinir(msg, args) {
        const word = String(args?.join(' ') || '').trim().toLowerCase();

        if (!word) {
            await msg.reply('❓ Use /definir [palavra] para ver a definição. Ex.: /definir casa');
            return;
        }

        try {
            const entry = await prisma.dictionary.findUnique({ where: { word } });

            if (!entry) {
                await msg.reply(`🔍 Não encontrei *${word}* no dicionário.`);
                return;
            }

            const sections = [
                ['Substantivo', entry.nounMeaning],
                ['Verbo', entry.verbMeaning],
                ['Adjetivo', entry.adjectiveMeaning],
                ['Advérbio', entry.adverbMeaning]
            ]
                .filter(([, meaning]) => meaning)
                .map(([label, meaning]) => `*${label}:* ${meaning}`);

            const text = `📖 *${entry.word}* (${entry.charactersCount} letras)\n\n${sections.join('\n\n')}`;
            await msg.reply(text);
        } catch (err) {
            console.error('Erro no /definir:', err);
            await msg.reply('❌ Não consegui buscar essa palavra agora, tente novamente em instantes.');
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
