const { MessageMedia } = require('whatsapp-web.js');
const path = require('node:path');
const fs = require('node:fs/promises');
const { prisma } = require('../database');
const { getSenderId } = require('../messageUtils');
const { buildCountryInfo, buildDictionaryInfo, buildMovieMessage } = require('./answerInfo');

const MAX_ERRORS = 7;
const DICTIONARY_MIN_LENGTH = 4;
const DICTIONARY_MAX_LENGTH = 14;
const DICTIONARY_PICK_ATTEMPTS = 20;
const LETTER_REGEX = /\p{L}/u;
const ONLY_LETTERS_REGEX = /^\p{L}+$/u;

// Argumento do /forca → modo. normalize() já tira acento e caixa, então
// "advérbio" chega como "adverbio" e "país" como "pais".
const MODE_ALIASES = {
    filme: 'filmes', filmes: 'filmes',
    pais: 'paises', paises: 'paises',
    dicionario: 'dicionario', dicionarios: 'dicionario',
    substantivo: 'substantivo', substantivos: 'substantivo',
    verbo: 'verbo', verbos: 'verbo',
    adjetivo: 'adjetivo', adjetivos: 'adjetivo',
    adverbio: 'adverbio', adverbios: 'adverbio'
};

// Modo → coluna do Dictionary que precisa estar preenchida.
const DICTIONARY_MEANING_FIELD = {
    substantivo: 'nounMeaning',
    verbo: 'verbMeaning',
    adjetivo: 'adjectiveMeaning',
    adverbio: 'adverbMeaning'
};

// Sorteados quando o /forca vem sem argumento.
const RANDOM_MODES = ['filmes', 'paises', 'dicionario', 'substantivo', 'verbo', 'adjetivo', 'adverbio'];

const MODE_TITLES = {
    filmes: '🎬 Jogo da Forca (Filmes)',
    paises: '🌍 Jogo da Forca (Países)',
    dicionario: '📖 Jogo da Forca (Dicionário)',
    substantivo: '📖 Jogo da Forca (Substantivo)',
    verbo: '📖 Jogo da Forca (Verbo)',
    adjetivo: '📖 Jogo da Forca (Adjetivo)',
    adverbio: '📖 Jogo da Forca (Advérbio)'
};

const MODE_LABELS = {
    filmes: 'filmes',
    paises: 'países',
    dicionario: 'dicionário',
    substantivo: 'substantivos',
    verbo: 'verbos',
    adjetivo: 'adjetivos',
    adverbio: 'advérbios'
};

function normalize(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function parseJsonArray(value) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

class ForcaGame {
    constructor() {
        this.activeGamesByChat = new Map();
        this.client = null;
    }

    setClient(client) {
        this.client = client;
    }

    async loadActiveGames() {
        if (!prisma?.gameForca) {
            console.warn('Aviso: prisma.gameForca indisponível. /forca desativado até rodar migrate/generate.');
            return;
        }

        try {
            const rows = await prisma.gameForca.findMany({
                where: { status: 'active' },
                include: { participants: true }
            });

            for (const row of rows) {
                const game = this.rowToState(row, row.participants);
                this.activeGamesByChat.set(row.chatId, game);
            }

            if (rows.length) {
                console.log(`🎯 Forca: ${rows.length} partida(s) ativa(s) recarregada(s) após reinício.`);
            }
        } catch (err) {
            console.error('Erro ao carregar partidas ativas do forca:', err?.message || err);
        }
    }

    rowToState(row, participantRows) {
        const answerLetterSet = new Set(
            Array.from(String(row.answer || ''))
                .filter((ch) => LETTER_REGEX.test(ch))
                .map((ch) => normalize(ch))
        );

        const participants = new Map();
        for (const p of participantRows || []) {
            participants.set(p.authorId, { pointsEarned: p.pointsEarned, eliminated: p.eliminated });
        }

        return {
            id: row.id,
            chatId: row.chatId,
            mode: row.mode,
            status: row.status,
            answer: row.answer,
            answerRef: row.answerRef,
            answerLetterSet,
            guessedLetters: new Set(parseJsonArray(row.guessedLetters)),
            wrongLetters: new Set(parseJsonArray(row.wrongLetters)),
            wrongGuesses: parseJsonArray(row.wrongGuesses),
            errorsCount: row.errorsCount,
            lastLetterAuthorId: row.lastLetterAuthorId,
            currentRoundMessageId: row.currentRoundMessageId,
            roundMessageIds: parseJsonArray(row.roundMessageIds),
            startedBy: row.startedBy,
            winnerId: row.winnerId,
            finishedAt: row.finishedAt,
            participants,
            processing: false
        };
    }

    getChatId(chat) {
        return chat?.id?._serialized || chat?.id?.user || '';
    }

    // --- Início de partida -------------------------------------------------

    async startGame(msg, chat, args) {
        const chatId = this.getChatId(chat);
        if (!chatId) return;

        const existing = this.activeGamesByChat.get(chatId);
        if (existing) {
            await msg.reply('🎯 Já existe uma partida de forca em andamento neste grupo! Reenviando a rodada atual...');
            await this.sendRound(chat, existing);
            return;
        }

        const modeArg = normalize(String(args?.[0] || ''));
        let mode;
        if (!modeArg) {
            mode = RANDOM_MODES[Math.floor(Math.random() * RANDOM_MODES.length)];
        } else if (MODE_ALIASES[modeArg]) {
            mode = MODE_ALIASES[modeArg];
        } else {
            await msg.reply(
                `❌ Não conheço o modo "${args[0]}".\n\n` +
                'Use */forca* sozinho para sortear um modo, ou escolha:\n' +
                '• /forca filmes\n' +
                '• /forca pais\n' +
                '• /forca dicionario\n' +
                '• /forca substantivo\n' +
                '• /forca verbo\n' +
                '• /forca adjetivo\n' +
                '• /forca advérbio'
            );
            return;
        }

        let answer;
        let answerRef = null;

        if (mode === 'filmes') {
            const movie = await this.pickRandomMovie();
            if (!movie) {
                await msg.reply('❌ Não encontrei filmes disponíveis para jogar agora.');
                return;
            }
            answer = movie.name;
            answerRef = movie.themoviedbId ? String(movie.themoviedbId) : null;
        } else if (mode === 'paises') {
            const country = await this.pickRandomCountry();
            if (!country) {
                await msg.reply('❌ Não encontrei países disponíveis para jogar agora.');
                return;
            }
            answer = country.name;
            answerRef = country.sigla;
        } else {
            const entry = await this.pickRandomDictionaryEntry(mode);
            if (!entry) {
                await msg.reply(`❌ Não encontrei ${MODE_LABELS[mode]} disponíveis para jogar agora.`);
                return;
            }
            answer = entry.word;
        }

        const authorId = getSenderId(msg) || 'unknown';

        let row;
        try {
            row = await prisma.gameForca.create({
                data: {
                    chatId,
                    mode,
                    status: 'active',
                    answer,
                    answerRef,
                    guessedLetters: '[]',
                    wrongLetters: '[]',
                    wrongGuesses: '[]',
                    errorsCount: 0,
                    roundMessageIds: '[]',
                    startedBy: authorId
                }
            });
        } catch (err) {
            console.error('Erro ao criar partida de forca:', err?.message || err);
            await msg.reply('❌ Não consegui iniciar o jogo da forca agora.');
            return;
        }

        const game = this.rowToState(row, []);
        this.activeGamesByChat.set(chatId, game);

        await this.sendRound(chat, game);
    }

    async pickRandomDictionaryEntry(mode = 'dicionario') {
        const field = DICTIONARY_MEANING_FIELD[mode];
        const where = {
            charactersCount: { gte: DICTIONARY_MIN_LENGTH, lte: DICTIONARY_MAX_LENGTH },
            ...(field
                ? { [field]: { not: null } }
                : {
                    OR: [
                        { nounMeaning: { not: null } },
                        { verbMeaning: { not: null } },
                        { adjectiveMeaning: { not: null } },
                        { adverbMeaning: { not: null } }
                    ]
                })
        };

        const total = await prisma.dictionary.count({ where });
        if (!total) return null;

        for (let attempt = 0; attempt < DICTIONARY_PICK_ATTEMPTS; attempt++) {
            const skip = Math.floor(Math.random() * total);
            const [entry] = await prisma.dictionary.findMany({ where, skip, take: 1 });
            if (entry && ONLY_LETTERS_REGEX.test(entry.word)) {
                return entry;
            }
        }

        return null;
    }

    async pickRandomMovie() {
        const where = { themoviedbId: { not: null } };
        const total = await prisma.movie.count({ where });
        if (!total) return null;

        const skip = Math.floor(Math.random() * total);
        const [movie] = await prisma.movie.findMany({ where, skip, take: 1 });
        return movie || null;
    }

    async pickRandomCountry() {
        const total = await prisma.country.count();
        if (!total) return null;

        const skip = Math.floor(Math.random() * total);
        const [country] = await prisma.country.findMany({ skip, take: 1 });
        return country || null;
    }

    // --- Palpites ------------------------------------------------------------

    async handleMessage(msg, chat) {
        const chatId = this.getChatId(chat);
        if (!chatId) return;

        const game = this.activeGamesByChat.get(chatId);
        if (!game || game.status !== 'active') return;

        const body = String(msg.body || '');
        if (body.trim().startsWith('/')) return;
        if (!msg.hasQuotedMsg) return;

        let quotedId = null;
        try {
            const quoted = await msg.getQuotedMessage();
            quotedId = quoted?.id?._serialized || quoted?.id?.id || null;
        } catch (_) {
            return;
        }
        if (!quotedId || !game.roundMessageIds.includes(quotedId)) return;

        if (quotedId !== game.currentRoundMessageId) {
            await msg.reply('É necessário responder a última rodada.');
            return;
        }

        if (game.processing) return;
        game.processing = true;

        try {
            await this.processGuess(msg, chat, game, body);
        } catch (err) {
            console.error('Erro ao processar jogada do forca:', err?.message || err);
        } finally {
            game.processing = false;
        }
    }

    async processGuess(msg, chat, game, body) {
        const trimmed = body.trim();
        if (!trimmed) return;

        const authorId = getSenderId(msg);
        if (!authorId) return;

        let participant = game.participants.get(authorId);
        if (!participant) {
            participant = { pointsEarned: 0, eliminated: false };
            game.participants.set(authorId, participant);
        }

        if (participant.eliminated) {
            await msg.reply('Você já perdeu neste jogo.');
            return;
        }

        const isLetterGuess = Array.from(trimmed).length === 1 && LETTER_REGEX.test(trimmed);

        if (isLetterGuess) {
            await this.processLetterGuess(chat, game, authorId, participant, trimmed, msg);
        } else {
            await this.processWordGuess(chat, game, authorId, participant, trimmed);
        }
    }

    async processLetterGuess(chat, game, authorId, participant, letter, msg) {
        if (authorId === game.lastLetterAuthorId) {
            await msg.reply('⏳ Você acabou de jogar uma letra. Espere outra pessoa jogar antes de tentar de novo.');
            return;
        }

        const normalized = normalize(letter);
        if (game.guessedLetters.has(normalized) || game.wrongLetters.has(normalized)) {
            await msg.reply('Essa letra já foi utilizada.');
            return;
        }

        game.lastLetterAuthorId = authorId;

        if (game.answerLetterSet.has(normalized)) {
            game.guessedLetters.add(normalized);
            participant.pointsEarned += 2;

            const won = [...game.answerLetterSet].every((l) => game.guessedLetters.has(l));
            if (won) {
                await this.finishGame(chat, game, { winnerId: authorId, won: true });
                return;
            }

            await this.sendRound(chat, game);
            return;
        }

        game.wrongLetters.add(normalized);
        game.errorsCount += 1;

        if (game.errorsCount >= MAX_ERRORS) {
            await this.finishGame(chat, game, { won: false });
            return;
        }

        await this.sendRound(chat, game);
    }

    async processWordGuess(chat, game, authorId, participant, guessRaw) {
        const normalizedGuess = normalize(guessRaw);
        const normalizedAnswer = normalize(game.answer);

        if (normalizedGuess === normalizedAnswer) {
            const hiddenDistinct = [...game.answerLetterSet].filter((l) => !game.guessedLetters.has(l)).length;
            participant.pointsEarned += 10 + (2 * hiddenDistinct);
            await this.finishGame(chat, game, { winnerId: authorId, won: true });
            return;
        }

        participant.pointsEarned = 0;
        participant.eliminated = true;

        const label = await this.resolveLabel(authorId);
        game.wrongGuesses.push({ authorId, guess: guessRaw, label });

        await this.sendRound(chat, game);
    }

    // --- Envio de rodada -------------------------------------------------

    buildMaskLine(answer, guessedSet) {
        return Array.from(String(answer || ''))
            .map((ch) => {
                if (!LETTER_REGEX.test(ch)) return ch;
                return guessedSet.has(normalize(ch)) ? ch : '_';
            })
            .join(' ');
    }

    // Descreve a estrutura da resposta ("2 palavras, 5 e 6 letras"). Um grupo é uma
    // sequência de letras; qualquer run de não-letra (espaço, hífen, pontuação) separa
    // grupos — o mesmo critério que o buildMaskLine usa para decidir o que vira "_".
    buildStructureLine(answer) {
        const sizes = String(answer || '')
            .split(/[^\p{L}]+/u)
            .filter(Boolean)
            .map((word) => Array.from(word).length);

        if (!sizes.length) return '';

        if (sizes.length === 1) {
            return `1 palavra, ${sizes[0]} ${sizes[0] === 1 ? 'letra' : 'letras'}`;
        }

        const last = sizes[sizes.length - 1];
        const letters = `${sizes.slice(0, -1).join(', ')} e ${last}`;
        return `${sizes.length} palavras, ${letters} letras`;
    }

    buildRoundText(game) {
        const title = MODE_TITLES[game.mode] || MODE_TITLES.dicionario;
        const maskLine = this.buildMaskLine(game.answer, game.guessedLetters);

        const lines = [`*${title}*`, '', maskLine];

        const structureLine = this.buildStructureLine(game.answer);
        if (structureLine) lines.push(structureLine);

        if (game.wrongLetters.size) {
            lines.push('', '❌ *Letras erradas:*', [...game.wrongLetters].map((l) => l.toUpperCase()).join(' '));
        }

        if (game.wrongGuesses.length) {
            lines.push('', '💀 *Chutes errados:*', ...game.wrongGuesses.map((g) => `${g.label} → ${g.guess}`));
        }

        let guessHint = '• um chute da palavra inteira.';
        if (game.mode === 'filmes') guessHint = '• o nome completo do filme.';
        if (game.mode === 'paises') guessHint = '• o nome completo do país.';
        lines.push('', 'Todos podem jogar. Responda ESTA imagem com:', '• uma letra', 'ou', guessHint);

        return lines.join('\n');
    }

    async sendRound(chat, game) {
        const text = this.buildRoundText(game);
        const imageIndex = Math.min(game.errorsCount, MAX_ERRORS);
        const imageName = `forca${imageIndex}.jpeg`;
        const imagePath = path.join(__dirname, '..', '..', 'storage', 'forca', imageName);

        try {
            const buffer = await fs.readFile(imagePath);
            const media = new MessageMedia('image/jpeg', buffer.toString('base64'), imageName);
            const sent = await chat.sendMessage(media, { caption: text });
            const sentId = sent?.id?._serialized || sent?.id?.id || null;
            if (sentId) {
                game.currentRoundMessageId = sentId;
                game.roundMessageIds.push(sentId);
            }
            await this.persistGame(game);
        } catch (err) {
            console.error('Erro ao enviar rodada do forca:', err?.message || err);
        }
    }

    // --- Fim de partida ----------------------------------------------------

    async finishGame(chat, game, { winnerId = null, won }) {
        game.status = won ? 'won' : 'lost';
        game.winnerId = winnerId;
        game.finishedAt = new Date();
        if (!won) game.errorsCount = MAX_ERRORS;

        await this.persistGame(game);

        const scoreLines = await this.buildScoreLines(game);

        const imageIndex = won ? Math.min(game.errorsCount, MAX_ERRORS) : MAX_ERRORS;
        const imageName = `forca${imageIndex}.jpeg`;
        const imagePath = path.join(__dirname, '..', '..', 'storage', 'forca', imageName);

        let media = null;
        try {
            const buffer = await fs.readFile(imagePath);
            media = new MessageMedia('image/jpeg', buffer.toString('base64'), imageName);
        } catch (_) {
            media = null;
        }

        let header;
        let mentions = [];
        if (won) {
            const label = await this.resolveLabel(winnerId);
            header = `🎉 *Parabéns @${label}!*`;
            mentions = [winnerId];
        } else {
            header = '💀 *A forca completou! Ninguém acertou dessa vez.*';
        }

        const lines = [
            header,
            '',
            `A resposta era: *${game.answer}*`,
            '',
            '🏆 *Pontuação:*',
            ...scoreLines
        ];

        if (!won) {
            lines.push('', 'Os pontos desta partida foram descartados.');
        }

        const text = lines.join('\n');

        try {
            if (media) {
                await chat.sendMessage(media, { caption: text, mentions });
            } else {
                await chat.sendMessage(text, { mentions });
            }
        } catch (err) {
            console.error('Erro ao enviar resultado do forca:', err?.message || err);
        }

        await this.sendAnswerInfo(chat, game);

        if (won) {
            await this.finalizeScores(game);
        }

        this.activeGamesByChat.delete(game.chatId);
    }

    async sendAnswerInfo(chat, game) {
        try {
            if (game.mode === 'filmes') {
                const { caption, media } = await buildMovieMessage(game.answerRef, game.answer);
                if (media) {
                    await chat.sendMessage(media, { caption });
                } else {
                    await chat.sendMessage(caption);
                }
                return;
            }

            if (game.mode === 'paises') {
                const text = await buildCountryInfo(game.answer, game.answerRef);
                await chat.sendMessage(text);
                return;
            }

            const text = await buildDictionaryInfo(game.answer);
            await chat.sendMessage(text);
        } catch (err) {
            console.error('Erro ao enviar descrição do forca:', err?.message || err);
        }
    }

    async buildScoreLines(game) {
        const entries = [...game.participants.entries()].sort((a, b) => b[1].pointsEarned - a[1].pointsEarned);
        if (!entries.length) return ['(sem participantes)'];

        const lines = [];
        for (const [authorId, p] of entries) {
            const label = await this.resolveLabel(authorId);
            lines.push(`${label} — ${p.pointsEarned} pontos${p.eliminated ? ' (eliminado)' : ''}`);
        }
        return lines;
    }

    async resolveLabel(authorId) {
        const fallback = String(authorId || '').split('@')[0];
        if (!this.client || !authorId) return fallback;
        try {
            const contact = await this.client.getContactById(authorId);
            return contact?.pushname || contact?.name || contact?.number || fallback;
        } catch (_) {
            return fallback;
        }
    }

    async finalizeScores(game) {
        for (const [authorId, p] of game.participants.entries()) {
            try {
                await prisma.gameScore.upsert({
                    where: {
                        chatId_authorId_gameType: {
                            chatId: game.chatId,
                            authorId,
                            gameType: 'forca'
                        }
                    },
                    create: {
                        chatId: game.chatId,
                        authorId,
                        gameType: 'forca',
                        totalPoints: p.pointsEarned,
                        wins: authorId === game.winnerId ? 1 : 0,
                        matchesPlayed: 1
                    },
                    update: {
                        totalPoints: { increment: p.pointsEarned },
                        wins: authorId === game.winnerId ? { increment: 1 } : undefined,
                        matchesPlayed: { increment: 1 }
                    }
                });
            } catch (err) {
                console.error('Erro ao atualizar pontuação do forca:', err?.message || err);
            }
        }
    }

    // --- Persistência --------------------------------------------------------

    async persistGame(game) {
        try {
            await prisma.gameForca.update({
                where: { id: game.id },
                data: {
                    status: game.status,
                    guessedLetters: JSON.stringify([...game.guessedLetters]),
                    wrongLetters: JSON.stringify([...game.wrongLetters]),
                    wrongGuesses: JSON.stringify(game.wrongGuesses),
                    errorsCount: game.errorsCount,
                    lastLetterAuthorId: game.lastLetterAuthorId,
                    currentRoundMessageId: game.currentRoundMessageId,
                    roundMessageIds: JSON.stringify(game.roundMessageIds),
                    winnerId: game.winnerId,
                    finishedAt: game.finishedAt || null
                }
            });

            for (const [authorId, p] of game.participants.entries()) {
                await prisma.gameForcaParticipant.upsert({
                    where: { gameId_authorId: { gameId: game.id, authorId } },
                    create: { gameId: game.id, authorId, pointsEarned: p.pointsEarned, eliminated: p.eliminated },
                    update: { pointsEarned: p.pointsEarned, eliminated: p.eliminated }
                });
            }
        } catch (err) {
            console.error('Erro ao persistir jogo da forca:', err?.message || err);
        }
    }
}

module.exports = ForcaGame;
