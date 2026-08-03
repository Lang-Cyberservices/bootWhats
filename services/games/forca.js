const { MessageMedia } = require('whatsapp-web.js');
const path = require('node:path');
const fs = require('node:fs/promises');
const { prisma } = require('../database');
const { getSenderId } = require('../messageUtils');

const MAX_ERRORS = 7;
const DICTIONARY_MIN_LENGTH = 4;
const DICTIONARY_MAX_LENGTH = 14;
const DICTIONARY_PICK_ATTEMPTS = 20;
const LETTER_REGEX = /\p{L}/u;
const ONLY_LETTERS_REGEX = /^\p{L}+$/u;

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
        const mode = (modeArg === 'filmes' || modeArg === 'filme') ? 'filmes' : 'dicionario';

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
        } else {
            const entry = await this.pickRandomDictionaryEntry();
            if (!entry) {
                await msg.reply('❌ Não encontrei palavras disponíveis para jogar agora.');
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

    async pickRandomDictionaryEntry() {
        const where = {
            charactersCount: { gte: DICTIONARY_MIN_LENGTH, lte: DICTIONARY_MAX_LENGTH },
            OR: [
                { nounMeaning: { not: null } },
                { verbMeaning: { not: null } },
                { adjectiveMeaning: { not: null } },
                { adverbMeaning: { not: null } }
            ]
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

    buildRoundText(game) {
        const title = game.mode === 'filmes' ? '🎬 Jogo da Forca (Filmes)' : '📖 Jogo da Forca (Dicionário)';
        const maskLine = this.buildMaskLine(game.answer, game.guessedLetters);

        const lines = [`*${title}*`, '', maskLine];

        if (game.wrongLetters.size) {
            lines.push('', '❌ *Letras erradas:*', [...game.wrongLetters].map((l) => l.toUpperCase()).join(' '));
        }

        if (game.wrongGuesses.length) {
            lines.push('', '💀 *Chutes errados:*', ...game.wrongGuesses.map((g) => `${g.label} → ${g.guess}`));
        }

        const guessHint = game.mode === 'filmes' ? '• o nome completo do filme.' : '• um chute da palavra inteira.';
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
                const { caption, media } = await this.buildMovieMessage(game.answerRef, game.answer);
                if (media) {
                    await chat.sendMessage(media, { caption });
                } else {
                    await chat.sendMessage(caption);
                }
                return;
            }

            const text = await this.buildDictionaryInfo(game.answer);
            await chat.sendMessage(text);
        } catch (err) {
            console.error('Erro ao enviar descrição do forca:', err?.message || err);
        }
    }

    async buildDictionaryInfo(word) {
        try {
            const entry = await prisma.dictionary.findUnique({ where: { word } });
            if (!entry) return `📖 *${word}*\n\nDefinição indisponível.`;

            const sections = [
                ['Substantivo', entry.nounMeaning],
                ['Verbo', entry.verbMeaning],
                ['Adjetivo', entry.adjectiveMeaning],
                ['Advérbio', entry.adverbMeaning]
            ]
                .filter(([, meaning]) => meaning)
                .map(([label, meaning]) => `*${label}:* ${meaning}`);

            const body = sections.length ? sections.join('\n\n') : 'Definição indisponível.';
            return `📖 *${entry.word}* (${entry.charactersCount} letras)\n\n${body}`;
        } catch (err) {
            console.error('Erro ao buscar definição do forca:', err?.message || err);
            return `📖 *${word}*\n\nDefinição indisponível.`;
        }
    }

    async buildMovieMessage(themoviedbId, fallbackName) {
        const apiKey = String(process.env.THEMOVIEDB_API || '').trim();
        if (!apiKey || !themoviedbId) return { caption: `🎬 ${fallbackName}`, media: null };

        try {
            const endpoint = `https://api.themoviedb.org/3/movie/${encodeURIComponent(themoviedbId)}?api_key=${encodeURIComponent(apiKey)}&language=pt-BR`;
            const res = await fetch(endpoint);
            if (!res.ok) return { caption: `🎬 ${fallbackName}`, media: null };

            const movie = await res.json();
            const title = String(movie?.title || fallbackName).trim();
            const originalTitle = String(movie?.original_title || '').trim();
            const year = String(movie?.release_date || '').slice(0, 4);
            const overview = this.sanitizeDescription(movie?.overview) || 'Sem sinopse disponível.';

            const yearPart = /^\d{4}$/.test(year) ? ` (${year})` : '';
            const originalPart = originalTitle && originalTitle !== title ? ` (_${originalTitle}_)` : '';
            const caption = [`🎬 *${title}*${yearPart}${originalPart}`, '', overview].join('\n');

            let media = null;
            const imagePath = movie?.backdrop_path || movie?.poster_path;
            if (imagePath) {
                const size = movie?.backdrop_path ? 'w780' : 'w500';
                const imageUrl = `https://image.tmdb.org/t/p/${size}${imagePath}`;
                try {
                    media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                } catch (err) {
                    console.error('Erro ao baixar capa do filme (forca):', err?.message || err);
                    media = null;
                }
            }

            return { caption, media };
        } catch (err) {
            console.error('Erro ao buscar detalhes do filme (forca):', err?.message || err);
            return { caption: `🎬 ${fallbackName}`, media: null };
        }
    }

    sanitizeDescription(text, maxLen = 700) {
        if (!text) return '';
        const clean = String(text).replace(/\s+/g, ' ').replace(/\u0000/g, '').trim();
        if (clean.length <= maxLen) return clean;
        return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
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
