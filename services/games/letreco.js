const { MessageMedia } = require('whatsapp-web.js');
const { prisma } = require('../database');
const { getSenderId } = require('../messageUtils');
const { renderBoard } = require('./letrecoBoard');
const { buildCountryInfo, buildDictionaryInfo, buildMovieMessage } = require('./answerInfo');
const {
    normalizeText,
    extractLetters,
    wordLengths,
    scoreGuess,
    tilesToChars,
    charsToTiles
} = require('./letrecoWords');

const MAX_ATTEMPTS = 10;

// A vez passa para outra pessoa depois de cada palpite válido; quem acabou de
// jogar só volta se ninguém jogar dentro do cooldown.
const SAME_PLAYER_COOLDOWN_MS = Number(process.env.LETRECO_COOLDOWN_MS) || 60_000;
const LETRECO_TIMEOUT_MS = Number(process.env.LETRECO_TIMEOUT_MS) || 6 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 10 * 60_000;

// Pontos por letra descoberta primeiro: amarelo (letra existe, posição errada)
// vale menos que verde (posição certa). Cada ocorrência da letra na resposta
// é premiada separadamente.
const POINTS_PRESENT = 1;
const POINTS_CORRECT = 2;

const DICT_MIN_LETTERS = 5;
const DICT_MAX_LETTERS = 8;
// Acima disso o tabuleiro fica ilegível no celular.
const BANK_MAX_LETTERS = 12;
const BANK_MAX_WORDS = 2;
const GUESS_MAX_WORDS = 3;
const GUESS_MAX_CHARS = 100;
const PICK_ATTEMPTS = 20;

const CATEGORIES = ['dicionario', 'filme', 'pais'];

const CATEGORY_ALIASES = {
    dicionario: 'dicionario', dicionarios: 'dicionario', palavra: 'dicionario', palavras: 'dicionario',
    filme: 'filme', filmes: 'filme',
    pais: 'pais', paises: 'pais'
};

const CATEGORY_TITLES = {
    dicionario: '🟩 *Letreco — Dicionário*',
    filme: '🟩 *Letreco — Filme*',
    pais: '🟩 *Letreco — País*'
};

const USAGE_MESSAGE =
    'Categoria inválida.\n\n' +
    'Use:\n' +
    '• /letreco — sorteia a categoria\n' +
    '• /letreco dicionario\n' +
    '• /letreco filme\n' +
    '• /letreco pais\n' +
    '• /letreco encerrar — encerra a partida atual';

const END_WORDS = new Set(['encerrar', 'encerra', 'parar', 'cancelar', 'desistir', 'fim']);

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

class LetrecoGame {
    constructor() {
        this.activeGamesByChat = new Map();
        this.labelCache = new Map();
        this.client = null;
        this.sweepTimer = null;
    }

    setClient(client) {
        this.client = client;
    }

    async loadActiveGames() {
        if (!prisma?.gameLetreco) {
            console.warn('Aviso: prisma.gameLetreco indisponível. /letreco desativado até rodar migrate/generate.');
            return;
        }

        try {
            const rows = await prisma.gameLetreco.findMany({ where: { status: 'active' } });

            for (const row of rows) {
                this.activeGamesByChat.set(row.chatId, this.rowToState(row));
            }

            if (rows.length) {
                console.log(`🟩 Letreco: ${rows.length} partida(s) ativa(s) recarregada(s) após reinício.`);
            }
        } catch (err) {
            console.error('Erro ao carregar partidas ativas do letreco:', err?.message || err);
        }

        this.startSweepTimer();
    }

    startSweepTimer() {
        if (this.sweepTimer) return;
        this.sweepTimer = setInterval(() => {
            this.sweepExpired().catch((err) =>
                console.error('Erro ao expirar partidas de letreco:', err?.message || err)
            );
        }, SWEEP_INTERVAL_MS);
        this.sweepTimer.unref?.();
    }

    rowToState(row) {
        return {
            id: row.id,
            chatId: row.chatId,
            category: row.category,
            status: row.status,
            answer: row.answer,
            answerLetters: row.answerLetters,
            answerRef: row.answerRef,
            wordLengths: parseJsonArray(row.wordLengths),
            guesses: parseJsonArray(row.guesses),
            lastPlayerId: row.lastPlayerId,
            lastPlayedAt: row.lastPlayedAt,
            currentRoundMessageId: row.currentRoundMessageId,
            roundMessageIds: parseJsonArray(row.roundMessageIds),
            startedBy: row.startedBy,
            winnerId: row.winnerId,
            createdAt: row.createdAt,
            finishedAt: row.finishedAt,
            processing: false
        };
    }

    getChatId(chat) {
        return chat?.id?._serialized || chat?.id?.user || '';
    }

    mentionsFor(ids) {
        return (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    }

    mentionTag(authorId) {
        return `@${String(authorId || '').split('@')[0]}`;
    }

    // Quem já pode jogar de novo: só o cooldown do último jogador segura alguém.
    samePlayerAllowedAt(game) {
        if (!game.lastPlayedAt) return 0;
        return new Date(game.lastPlayedAt).getTime() + SAME_PLAYER_COOLDOWN_MS;
    }

    // --- Início de partida ---------------------------------------------------

    async startGame(msg, chat, args) {
        const chatId = this.getChatId(chat);
        if (!chatId) return;

        if (!prisma?.gameLetreco) {
            await msg.reply('❌ O letreco ainda não está disponível. Rode as migrations e tente novamente.');
            return;
        }

        await this.sweepExpired();

        const authorId = getSenderId(msg);
        if (!authorId) return;

        const arg = normalize(String(args?.[0] || ''));

        if (END_WORDS.has(arg)) {
            await this.handleEndRequest(msg, chat, chatId, authorId);
            return;
        }

        const existing = this.activeGamesByChat.get(chatId);
        if (existing) {
            await msg.reply('🟩 Já existe um Letreco em andamento neste grupo! Reenviando o tabuleiro...');
            await this.sendBoard(chat, existing);
            return;
        }

        let category;
        if (!arg) {
            category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
        } else if (CATEGORY_ALIASES[arg]) {
            category = CATEGORY_ALIASES[arg];
        } else {
            await msg.reply(USAGE_MESSAGE);
            return;
        }

        const entry = await this.pickAnswer(category);
        if (!entry) {
            await msg.reply('❌ Não encontrei uma resposta jogável para essa categoria agora.');
            return;
        }

        let row;
        try {
            row = await prisma.gameLetreco.create({
                data: {
                    chatId,
                    category,
                    status: 'active',
                    answer: entry.answer,
                    answerLetters: entry.letters,
                    answerRef: entry.ref || null,
                    wordLengths: JSON.stringify(entry.wordLengths),
                    guesses: '[]',
                    attempts: 0,
                    roundMessageIds: '[]',
                    startedBy: authorId
                }
            });
        } catch (err) {
            console.error('Erro ao criar partida de letreco:', err?.message || err);
            await msg.reply('❌ Não consegui iniciar o letreco agora.');
            return;
        }

        const game = this.rowToState(row);
        this.activeGamesByChat.set(chatId, game);

        await this.sendBoard(chat, game);
    }

    async handleEndRequest(msg, chat, chatId, authorId) {
        const game = this.activeGamesByChat.get(chatId);
        if (!game) {
            await msg.reply('Não existe um Letreco ativo neste chat.\n\nUse */letreco* para iniciar.');
            return;
        }

        const allowed = authorId === game.startedBy || await this.isGroupAdmin(chat, authorId);
        if (!allowed) {
            await msg.reply('❌ Só quem começou a partida ou um administrador do grupo pode encerrá-la.');
            return;
        }

        game.status = 'expired';
        game.finishedAt = new Date();
        await this.persistGame(game);
        this.activeGamesByChat.delete(chatId);

        await this.sendFinalBoard(chat, game, {
            caption: `🟩 *Letreco encerrado.*\n\nA resposta era: *${game.answer}*\n\nOs pontos desta partida foram descartados.`
        });
    }

    async isGroupAdmin(chat, authorId) {
        try {
            const participant = (chat?.participants || []).find(
                (p) => (p?.id?._serialized || p?.id?.user) === authorId
            );
            return Boolean(participant?.isAdmin || participant?.isSuperAdmin);
        } catch (_) {
            return false;
        }
    }

    // --- Sorteio da resposta -------------------------------------------------

    async pickAnswer(category) {
        if (category === 'filme') return this.pickFromBank('filme');
        if (category === 'pais') return this.pickFromBank('pais');
        return this.pickDictionaryAnswer();
    }

    async pickDictionaryAnswer() {
        // Mesmo filtro do /forca: entradas sem nenhum significado preenchido
        // costumam ser lixo de importação.
        const where = {
            charactersCount: { gte: DICT_MIN_LETTERS, lte: DICT_MAX_LETTERS },
            OR: [
                { nounMeaning: { not: null } },
                { verbMeaning: { not: null } },
                { adjectiveMeaning: { not: null } },
                { adverbMeaning: { not: null } }
            ]
        };

        const total = await prisma.dictionary.count({ where });
        if (!total) return null;

        for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
            const skip = Math.floor(Math.random() * total);
            const [entry] = await prisma.dictionary.findMany({ where, skip, take: 1 });
            const candidate = this.toEntry(entry?.word);
            if (!candidate) continue;
            if (candidate.wordLengths.length !== 1) continue;
            if (candidate.letters.length < DICT_MIN_LETTERS) continue;
            if (candidate.letters.length > DICT_MAX_LETTERS) continue;
            return candidate;
        }

        return null;
    }

    async pickFromBank(category) {
        const isMovie = category === 'filme';
        const where = isMovie ? { themoviedbId: { not: null } } : {};

        const total = isMovie
            ? await prisma.movie.count({ where })
            : await prisma.country.count();
        if (!total) return null;

        for (let attempt = 0; attempt < PICK_ATTEMPTS; attempt++) {
            const skip = Math.floor(Math.random() * total);
            const [row] = isMovie
                ? await prisma.movie.findMany({ where, skip, take: 1 })
                : await prisma.country.findMany({ skip, take: 1 });

            const candidate = this.toEntry(row?.name);
            if (!candidate) continue;
            if (candidate.wordLengths.length > BANK_MAX_WORDS) continue;
            if (candidate.letters.length < DICT_MIN_LETTERS) continue;
            if (candidate.letters.length > BANK_MAX_LETTERS) continue;

            candidate.ref = isMovie
                ? (row.themoviedbId ? String(row.themoviedbId) : null)
                : (row.sigla || null);
            return candidate;
        }

        return null;
    }

    // A grafia original é guardada para a revelação; a normalizada, para o jogo.
    toEntry(rawAnswer) {
        const answer = String(rawAnswer || '').trim();
        if (!answer) return null;
        const letters = extractLetters(answer);
        if (!letters) return null;
        return { answer, letters, wordLengths: wordLengths(answer), ref: null };
    }

    // --- Palpites ------------------------------------------------------------

    async handleMessage(msg, chat) {
        if (!this.activeGamesByChat.size) return;

        const chatId = this.getChatId(chat);
        if (!chatId) return;

        await this.sweepExpired();

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
            await msg.reply('Esse tabuleiro está desatualizado.\n\nResponda à imagem mais recente para enviar seu palpite.');
            return;
        }

        if (game.processing) return;
        game.processing = true;

        try {
            await this.processGuess(msg, chat, game, body);
        } catch (err) {
            console.error('Erro ao processar jogada do letreco:', err?.message || err);
        } finally {
            game.processing = false;
        }
    }

    async processGuess(msg, chat, game, body) {
        const authorId = getSenderId(msg);
        if (!authorId) return;

        const raw = body.trim();
        if (!raw) return;

        // Nada abaixo desta linha que devolva erro consome tentativa ou muda a vez.
        if (authorId === game.lastPlayerId) {
            const allowedAt = this.samePlayerAllowedAt(game);
            if (Date.now() < allowedAt) {
                const seconds = Math.ceil((allowedAt - Date.now()) / 1000);
                await msg.reply(
                    'Agora é a vez de outra pessoa.\n\n' +
                    `Você poderá jogar novamente em ${seconds} segundos caso ninguém jogue antes.`
                );
                return;
            }
        }

        if (raw.includes('\n') || raw.length > GUESS_MAX_CHARS) return;

        const normalized = normalizeText(raw);
        const letters = extractLetters(raw);
        if (!letters) return;

        if (normalized.split(' ').filter(Boolean).length > GUESS_MAX_WORDS) return;

        if (!this.isGuessAcceptable(game, letters)) {
            const total = game.answerLetters.length;
            await msg.reply(
                `Palpite inválido: envie um palpite com ${total} letras.\n` +
                'Espaços e acentos não entram na contagem.'
            );
            return;
        }

        const tiles = scoreGuess(game.answerLetters, letters);
        const label = await this.resolveLabel(authorId);

        game.guesses.push({
            playerId: authorId,
            label,
            raw,
            letters,
            tiles: tilesToChars(tiles),
            at: Date.now()
        });
        game.lastPlayerId = authorId;
        game.lastPlayedAt = new Date();

        if (letters === game.answerLetters) {
            await this.finishGame(chat, game, { won: true, winnerId: authorId, winnerLabel: label });
            return;
        }

        if (game.guesses.length >= MAX_ATTEMPTS) {
            await this.finishGame(chat, game, { won: false });
            return;
        }

        await this.sendBoard(chat, game);
    }

    // Único ponto de validação do palpite: hoje basta bater o número de letras.
    // Se um dia o palpite precisar existir no banco da categoria, é aqui.
    isGuessAcceptable(game, letters) {
        return letters.length === game.answerLetters.length;
    }

    // --- Tabuleiro -----------------------------------------------------------

    boardRows(game) {
        return game.guesses.map((guess) => ({
            letters: guess.letters,
            tiles: charsToTiles(guess.tiles),
            label: guess.label
        }));
    }

    async renderGameImage(game, { winnerLabel = null } = {}) {
        const buffer = await renderBoard({
            status: game.status,
            wordLengths: game.wordLengths,
            rows: this.boardRows(game),
            answer: game.status === 'active' ? null : game.answer,
            winnerLabel
        });
        return new MessageMedia('image/png', buffer.toString('base64'), 'letreco.png');
    }

    buildRoundText(game) {
        const title = CATEGORY_TITLES[game.category] || CATEGORY_TITLES.dicionario;
        const total = game.answerLetters.length;
        const remaining = MAX_ATTEMPTS - game.guesses.length;
        const structure = game.wordLengths.length > 1
            ? ` (${game.wordLengths.length} palavras: ${game.wordLengths.join(' e ')} letras)`
            : '';

        const lines = [
            title,
            '',
            `Responda a ESTA imagem com um palpite de ${total} letras${structure}.`,
            '',
            'Depois de jogar, outra pessoa tem prioridade por 60 segundos.',
            `Tentativas disponíveis: ${remaining}.`
        ];

        const last = game.guesses[game.guesses.length - 1];
        if (last) {
            lines.splice(2, 0, `Último palpite: *${last.letters}* — ${last.label}`, '');
        }

        return lines.join('\n');
    }

    // Funil único de envio: é aqui que o tabuleiro atual passa a valer.
    async sendBoard(chat, game) {
        try {
            const media = await this.renderGameImage(game);
            const sent = await chat.sendMessage(media, { caption: this.buildRoundText(game) });
            const sentId = sent?.id?._serialized || sent?.id?.id || null;
            if (sentId) {
                game.currentRoundMessageId = sentId;
                game.roundMessageIds.push(sentId);
            }
            await this.persistGame(game);
        } catch (err) {
            // O estado continua válido: o tabuleiro anterior segue sendo o atual
            // e o palpite já registrado não se perde.
            console.error('Erro ao enviar tabuleiro do letreco:', err?.message || err);
        }
    }

    async sendFinalBoard(chat, game, { caption, mentions = [], winnerLabel = null }) {
        try {
            const media = await this.renderGameImage(game, { winnerLabel });
            await chat.sendMessage(media, { caption, mentions });
        } catch (err) {
            console.error('Erro ao enviar resultado do letreco:', err?.message || err);
            try {
                await chat.sendMessage(caption, { mentions });
            } catch (_) {}
        }
    }

    // --- Fim de partida ------------------------------------------------------

    async finishGame(chat, game, { won, winnerId = null, winnerLabel = null }) {
        game.status = won ? 'won' : 'lost';
        game.winnerId = winnerId;
        game.finishedAt = new Date();

        await this.persistGame(game);
        this.activeGamesByChat.delete(game.chatId);

        // Como no /forca: só quem vence pontua. Ninguém acertando, os pontos
        // desta partida são descartados.
        const scoreLines = won ? await this.finalizeScores(game) : [];

        const lines = [];
        let mentions = [];

        if (won) {
            lines.push(`🎉 *${this.mentionTag(winnerId)} acertou!*`, '');
            mentions = this.mentionsFor([winnerId]);
        } else {
            lines.push('❌ *Fim de jogo.*', '', 'As 10 tentativas foram utilizadas.');
        }

        lines.push(`Resposta: *${game.answer}*`, `Tentativas utilizadas: ${game.guesses.length}/${MAX_ATTEMPTS}`);

        if (won) {
            lines.push('', '🏆 *Pontuação desta partida:*', ...scoreLines);
        } else {
            lines.push('', 'Os pontos desta partida foram descartados.');
        }

        await this.sendFinalBoard(chat, game, {
            caption: lines.join('\n'),
            mentions,
            winnerLabel
        });

        await this.sendAnswerInfo(chat, game);
    }

    async sendAnswerInfo(chat, game) {
        try {
            if (game.category === 'filme') {
                const { caption, media } = await buildMovieMessage(game.answerRef, game.answer);
                if (media) {
                    await chat.sendMessage(media, { caption });
                } else {
                    await chat.sendMessage(caption);
                }
                return;
            }

            if (game.category === 'pais') {
                const text = await buildCountryInfo(game.answer, game.answerRef);
                await chat.sendMessage(text);
                return;
            }

            const text = await buildDictionaryInfo(game.answer);
            await chat.sendMessage(text);
        } catch (err) {
            console.error('Erro ao enviar descrição do letreco:', err?.message || err);
        }
    }

    // 1 ponto para quem primeiro descobre que uma letra existe na resposta
    // (amarelo), 2 pontos para quem primeiro acerta a posição certa dela
    // (verde). Cada ocorrência da letra na resposta é premiada separadamente,
    // então uma letra repetida rende pontos mais de uma vez. Reprocessa os
    // palpites em ordem cronológica para achar quem chegou primeiro em cada
    // descoberta — não há bônus por quantidade de palpites nem por vitória.
    computeScores(game) {
        const points = new Map();
        const addPoints = (playerId, amount) => {
            points.set(playerId, (points.get(playerId) || 0) + amount);
        };

        const totalCount = new Map();
        for (const letter of game.answerLetters) {
            totalCount.set(letter, (totalCount.get(letter) || 0) + 1);
        }

        const positionDiscovered = new Set();
        const discoveredCount = new Map();

        for (const guess of game.guesses) {
            const tiles = charsToTiles(guess.tiles);
            const letters = guess.letters;

            for (let i = 0; i < tiles.length; i++) {
                const letter = letters[i];

                if (tiles[i] === 'correct') {
                    if (!positionDiscovered.has(i)) {
                        positionDiscovered.add(i);
                        discoveredCount.set(letter, (discoveredCount.get(letter) || 0) + 1);
                        addPoints(guess.playerId, POINTS_CORRECT);
                    }
                    continue;
                }

                if (tiles[i] === 'present') {
                    const discovered = discoveredCount.get(letter) || 0;
                    if (discovered < (totalCount.get(letter) || 0)) {
                        discoveredCount.set(letter, discovered + 1);
                        addPoints(guess.playerId, POINTS_PRESENT);
                    }
                }
            }
        }

        const won = game.status === 'won';
        const scores = [...points.entries()].map(([playerId, total]) => ({
            playerId,
            points: total,
            isWinner: won && playerId === game.winnerId
        }));

        return scores.sort((a, b) => b.points - a.points);
    }

    async finalizeScores(game) {
        const scores = this.computeScores(game);
        const lines = [];

        for (const score of scores) {
            const label = await this.resolveLabel(score.playerId);
            lines.push(`• ${label}: ${score.points} ${score.points === 1 ? 'ponto' : 'pontos'}${score.isWinner ? ' 🏅' : ''}`);

            try {
                await prisma.gameScore.upsert({
                    where: {
                        chatId_authorId_gameType: {
                            chatId: game.chatId,
                            authorId: score.playerId,
                            gameType: 'letreco'
                        }
                    },
                    create: {
                        chatId: game.chatId,
                        authorId: score.playerId,
                        gameType: 'letreco',
                        totalPoints: score.points,
                        wins: score.isWinner ? 1 : 0,
                        losses: 0,
                        matchesPlayed: 1
                    },
                    update: {
                        totalPoints: { increment: score.points },
                        wins: score.isWinner ? { increment: 1 } : undefined,
                        matchesPlayed: { increment: 1 }
                    }
                });
            } catch (err) {
                console.error('Erro ao salvar pontuação do letreco:', err?.message || err);
            }
        }

        return lines;
    }

    // --- Expiração -----------------------------------------------------------

    async sweepExpired() {
        const now = Date.now();

        for (const [chatId, game] of [...this.activeGamesByChat.entries()]) {
            if (game.processing) continue;

            const reference = game.lastPlayedAt || game.createdAt;
            const referenceMs = reference ? new Date(reference).getTime() : now;
            if (now - referenceMs < LETRECO_TIMEOUT_MS) continue;

            game.status = 'expired';
            game.finishedAt = new Date();
            await this.persistGame(game);
            this.activeGamesByChat.delete(chatId);

            try {
                await this.client?.sendMessage(
                    chatId,
                    '🟩 *Letreco encerrado por inatividade.*\n\n' +
                    `A resposta era: *${game.answer}*\n\n` +
                    'Use */letreco* para começar outro.'
                );
            } catch (err) {
                console.error('Erro ao avisar expiração do letreco:', err?.message || err);
            }
        }
    }

    // --- Persistência --------------------------------------------------------

    async resolveLabel(authorId) {
        if (!authorId) return 'alguém';
        if (this.labelCache.has(authorId)) return this.labelCache.get(authorId);

        let label = String(authorId).split('@')[0];
        try {
            const contact = await this.client?.getContactById(authorId);
            label = contact?.pushname || contact?.name || contact?.number || label;
        } catch (_) {}

        this.labelCache.set(authorId, label);
        return label;
    }

    async persistGame(game) {
        if (!prisma?.gameLetreco) return;

        try {
            await prisma.gameLetreco.update({
                where: { id: game.id },
                data: {
                    status: game.status,
                    guesses: JSON.stringify(game.guesses),
                    attempts: game.guesses.length,
                    lastPlayerId: game.lastPlayerId,
                    lastPlayedAt: game.lastPlayedAt,
                    currentRoundMessageId: game.currentRoundMessageId,
                    roundMessageIds: JSON.stringify(game.roundMessageIds),
                    winnerId: game.winnerId,
                    finishedAt: game.finishedAt
                }
            });
        } catch (err) {
            console.error('Erro ao salvar partida de letreco:', err?.message || err);
        }
    }
}

module.exports = LetrecoGame;
