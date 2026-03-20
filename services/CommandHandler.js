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

// Controle simples de flood por usuário (em memória)
const COMMAND_WINDOW_MS = 60_000;
const DEFAULT_MAX_COMMANDS_PER_MINUTE = 3;
const MAX_COMMANDS_PER_MINUTE = (() => {
    const raw = process.env.MAX_COMMANDS_PER_MINUTE;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_COMMANDS_PER_MINUTE;
})();
const commandHistoryByUser = new Map(); // key: authorId, value: number[]

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

        const [command, ...args] = body.trim().split(/\s+/);

        const authorId = getSenderId(msg);
        const knownCommands = ['/ban', '/oraculo', '/sobre', '/ajuda', '/sticker', '/piada', '/proibir', '/rank' ];
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

        if (command === '/oraculo') {
            return this.handleOraculo(msg, chat);
        }

        if (command === '/sobre') {
            return this.handleSobre(msg, chat);
        }

        if (command === '/ajuda') {
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

        return await msg.reply('❌ Por que invocar um comando que nem o próprio bot reconhece? Use /ajuda e ilumine-se antes de tentar de novo.');
    }

    async handleBan(msg, chat) {
        const authorId = getSenderId(msg);
        

        if (!this.isAdmin(msg, chat)) {
            await msg.reply('❌ Nem todos que sonham com poder estão prontos para exercê-lo. Apenas administradores podem usar este comando.');
            return;
        }

        if (!msg.hasQuotedMsg) {
            await msg.reply('❓ Para purificar este antro da tolice, aponta tua lanterna para a face do imundo — responde à mensagem daquele que não merece o sol — e brada o decreto: /ban');
            return;
        }

        const quotedMsg = await msg.getQuotedMessage();
        const userToBan = quotedMsg.author;

        try {
            await chat.removeParticipants([userToBan]);
            await msg.reply('Finalmente, um pouco de silêncio. O estorvo foi removido e o ar parece mais limpo. Agora, saia do meu sol para que eu possa contemplar o nada em paz.');
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

        const mentions = [];
        const labelById = new Map();
        if (this.client) {
            for (const id of uniqueIds) {
                try {
                    const contact = await this.client.getContactById(id);
                    if (contact) {
                        mentions.push(contact);
                        const label = contact?.number ? `@${contact.number}` : `@${id.split('@')[0]}`;
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
                const label = labelById.get(s.authorId) || (s.phone ? `@${s.phone}` : `@${String(s.authorId).split('@')[0]}`);
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

        if (mentions.length > 0) {
            await chat.sendMessage(text, { mentions });
        } else {
            await msg.reply(text);
        }
    }

    async handleSobre(msg, _chat) {
        const text =
`🤖 *Sobre o bot*

Diogenes foi criado por um unico programador, com o orçamento de meio sanduiche de presunto, em um tempo muito curto e esta hospedado num pc do milhão.
Então falhs podem e irão acontecer, ao encotra-las avise que iremos chicotear o programador até ele corrigir ou morrer tentanto.
_versão: 2.1.0_`;

        await msg.reply(text);
    }

    async handleAjuda(msg, _chat) {
        const text =
`📖 *Lista de comandos disponíveis*

- 🔨 */ban*  
  Apenas administradores. Responda a uma mensagem com /ban para remover o usuário do grupo.

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

- ℹ️ */sobre*  
  Mostra um resumo sobre o bot e quem desenvolveu.

- ❓ */ajuda*  
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
