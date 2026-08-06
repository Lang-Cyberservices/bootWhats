const { MessageMedia } = require('whatsapp-web.js');
const { Chess } = require('chess.js');
const { prisma } = require('../database');
const { getSenderId } = require('../messageUtils');
const { renderBoard } = require('./chessBoard');

// Partida sem adversário morre rápido; partida em andamento tem um dia inteiro
// para o próximo lance. Ambos configuráveis para dar para testar sem esperar.
const WAIT_TIMEOUT_MS = Number(process.env.XADREZ_WAIT_TIMEOUT_MS) || 15 * 60_000;
const MOVE_TIMEOUT_MS = Number(process.env.XADREZ_MOVE_TIMEOUT_MS) || 24 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 10 * 60_000;

// Anti-farm: duas pessoas abrindo partida e desistindo em seguida não pontuam.
const MIN_MOVES_FOR_POINTS = 10;
const POINTS_WIN = 30;
const POINTS_DRAW = 15;

// Modo secreto `/xadrez solo`: só existe no grupo de desenvolvimento e serve
// para validar a partida inteira sem precisar de dois celulares. O adversário
// é um sentinela que nunca é um JID real — daí ele nunca poder entrar no array
// `mentions` de um sendMessage.
const BOT_PLAYER_ID = 'diogenes@bot';
const BOT_LABEL = 'Diogenes';
const DEV_GROUP_ID = (process.env.DEV_GROUP_ID || '').trim();
const SOLO_DENIED_MESSAGE = 'Ora, veja só! Você encontrou uma sequência bonita de palavras, uma verdadeira "fórmula mágica". E para quê? Para nada!';

const JOIN_WORDS = new Set(['xadrez', 'chess', 'entrar', 'jogar', 'bora']);
const RESIGN_WORDS = new Set(['desistir', 'desisto', 'resign', 'abandonar']);
const DRAW_WORDS = new Set(['empate', 'empatar', 'draw']);
const YES_WORDS = new Set(['sim', 's', 'aceito', 'ok', 'yes']);
const NO_WORDS = new Set(['nao', 'n', 'recuso', 'no']);

// "a1 a3", "a1a3", "a1-a3", "e7e8=Q" — a promoção sem letra vira dama.
const COORD_MOVE_REGEX = /^([a-h][1-8])\s*(?:[-x>]\s*)?([a-h][1-8])\s*(?:=\s*)?([qrbn])?$/i;

const DRAW_REASON_LABELS = {
    stalemate: 'afogamento (rei sem lances legais)',
    insufficient_material: 'material insuficiente',
    threefold: 'repetição tripla',
    fifty_moves: 'regra dos 50 lances',
    agreement: 'acordo entre os jogadores',
    draw: 'posição empatada'
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

function findKingSquare(chess, color) {
    for (const row of chess.board()) {
        for (const cell of row) {
            if (cell && cell.type === 'k' && cell.color === color) return cell.square;
        }
    }
    return null;
}

class XadrezGame {
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
        if (!prisma?.gameXadrez) {
            console.warn('Aviso: prisma.gameXadrez indisponível. /xadrez desativado até rodar migrate/generate.');
            return;
        }

        try {
            const rows = await prisma.gameXadrez.findMany({
                where: { status: { in: ['waiting', 'active'] } }
            });

            for (const row of rows) {
                this.activeGamesByChat.set(row.chatId, this.rowToState(row));
            }

            if (rows.length) {
                console.log(`♟️ Xadrez: ${rows.length} partida(s) ativa(s) recarregada(s) após reinício.`);
            }
        } catch (err) {
            console.error('Erro ao carregar partidas ativas do xadrez:', err?.message || err);
        }

        this.startSweepTimer();
    }

    startSweepTimer() {
        if (this.sweepTimer) return;
        this.sweepTimer = setInterval(() => {
            this.sweepExpired().catch((err) =>
                console.error('Erro ao expirar partidas de xadrez:', err?.message || err)
            );
        }, SWEEP_INTERVAL_MS);
        this.sweepTimer.unref?.();
    }

    rowToState(row) {
        return {
            id: row.id,
            chatId: row.chatId,
            status: row.status,
            player1Id: row.player1Id,
            player2Id: row.player2Id,
            whiteId: row.whiteId,
            blackId: row.blackId,
            fen: row.fen,
            movesSan: parseJsonArray(row.movesSan),
            lastMoveFrom: row.lastMoveFrom,
            lastMoveTo: row.lastMoveTo,
            drawOfferBy: row.drawOfferBy,
            currentRoundMessageId: row.currentRoundMessageId,
            roundMessageIds: parseJsonArray(row.roundMessageIds),
            startedBy: row.startedBy,
            result: row.result,
            winnerId: row.winnerId,
            endReason: row.endReason,
            lastMoveAt: row.lastMoveAt,
            createdAt: row.createdAt,
            finishedAt: row.finishedAt,
            processing: false
        };
    }

    getChatId(chat) {
        return chat?.id?._serialized || chat?.id?.user || '';
    }

    isBot(authorId) {
        return authorId === BOT_PLAYER_ID;
    }

    // Derivado do estado persistido, e não de uma coluna: uma partida solo
    // volta a ser solo depois de um restart sem nenhuma migration extra.
    isSolo(game) {
        return game?.player2Id === BOT_PLAYER_ID;
    }

    mentionsFor(ids) {
        return (Array.isArray(ids) ? ids : [ids]).filter((id) => id && !this.isBot(id));
    }

    // A posição é reconstruída replayando os lances, e não carregada do FEN:
    // só com o histórico o chess.js enxerga repetição tripla e os 50 lances.
    buildChess(game) {
        const chess = new Chess();
        for (const san of game.movesSan) {
            try {
                chess.move(san);
            } catch (err) {
                console.error(`Xadrez: replay falhou no lance "${san}" (partida ${game.id}). Usando o FEN salvo.`);
                return new Chess(game.fen);
            }
        }
        return chess;
    }

    // --- Início de partida ---------------------------------------------------

    async startGame(msg, chat, args) {
        const chatId = this.getChatId(chat);
        if (!chatId) return;

        if (!prisma?.gameXadrez) {
            await msg.reply('❌ O xadrez ainda não está disponível. Rode as migrations e tente novamente.');
            return;
        }

        const solo = normalize(args?.[0]) === 'solo';
        if (solo && (!DEV_GROUP_ID || chatId !== DEV_GROUP_ID)) {
            await msg.reply(SOLO_DENIED_MESSAGE);
            return;
        }

        await this.sweepExpired();

        const authorId = getSenderId(msg);
        if (!authorId) return;

        const existing = this.activeGamesByChat.get(chatId);
        if (existing) {
            if (existing.status === 'waiting' && existing.player1Id !== authorId) {
                await this.joinGame(msg, chat, existing, authorId);
                return;
            }

            await msg.reply(existing.status === 'waiting'
                ? '♟️ Você já abriu uma partida e ela ainda está esperando um adversário. Reenviando o tabuleiro...'
                : '♟️ Já existe uma partida de xadrez em andamento neste grupo! Reenviando o tabuleiro...');
            await this.sendBoard(chat, existing);
            return;
        }

        const chess = new Chess();
        let row;
        try {
            row = await prisma.gameXadrez.create({
                data: {
                    chatId,
                    status: 'waiting',
                    player1Id: authorId,
                    fen: chess.fen(),
                    movesSan: '[]',
                    roundMessageIds: '[]',
                    startedBy: authorId
                }
            });
        } catch (err) {
            console.error('Erro ao criar partida de xadrez:', err?.message || err);
            await msg.reply('❌ Não consegui iniciar a partida de xadrez agora.');
            return;
        }

        const game = this.rowToState(row);
        this.activeGamesByChat.set(chatId, game);

        if (solo) {
            await this.startSoloMatch(chat, game);
            return;
        }

        await this.sendBoard(chat, game);
    }

    // Sorteio de quem joga com as brancas (e, portanto, começa). Vale tanto
    // para a entrada de um humano quanto para o Diogenes.
    activateMatch(game, opponentId) {
        const whiteFirst = Math.random() < 0.5;
        game.player2Id = opponentId;
        game.whiteId = whiteFirst ? game.player1Id : opponentId;
        game.blackId = whiteFirst ? opponentId : game.player1Id;
        game.status = 'active';
        game.lastMoveAt = new Date();
    }

    async joinGame(msg, chat, game, authorId) {
        if (authorId === game.player1Id) {
            await msg.reply('♟️ Você já está nesta partida. Falta alguém aceitar o desafio!');
            return;
        }

        this.activateMatch(game, authorId);

        await this.persistGame(game);
        await this.sendBoard(chat, game, { justStarted: true });
    }

    async startSoloMatch(chat, game) {
        this.activateMatch(game, BOT_PLAYER_ID);

        const moveLines = [];
        const chess = this.buildChess(game);

        // Se o Diogenes tirou as brancas, ele abre a partida antes do primeiro
        // tabuleiro — assim a imagem já sai com a vez do humano.
        if (game.whiteId === BOT_PLAYER_ID) {
            const botMove = this.playBotMove(game, chess);
            if (botMove) moveLines.push(this.buildBotMoveLine(botMove));
        }

        await this.persistGame(game);
        await this.sendBoard(chat, game, { justStarted: true, moveLines, chess });
    }

    // Lance do Diogenes: um sorteio simples entre os lances legais da posição.
    playBotMove(game, chess) {
        const options = chess.moves({ verbose: true });
        if (!options.length) return null;

        const chosen = options[Math.floor(Math.random() * options.length)];
        const move = chess.move(chosen.san);

        game.movesSan.push(move.san);
        game.fen = chess.fen();
        game.lastMoveFrom = move.from;
        game.lastMoveTo = move.to;
        game.lastMoveAt = new Date();
        game.drawOfferBy = null;

        return move;
    }

    buildBotMoveLine(move) {
        return `🤖 ${BOT_LABEL} jogou *${move.from}→${move.to}* (${move.san})`;
    }

    // --- Respostas às mensagens da partida -----------------------------------

    async handleMessage(msg, chat) {
        const chatId = this.getChatId(chat);
        if (!chatId) return;

        if (!this.activeGamesByChat.size) return;

        await this.sweepExpired();

        const game = this.activeGamesByChat.get(chatId);
        if (!game) return;

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
            await msg.reply('É necessário responder a última mensagem da partida.');
            return;
        }

        if (game.processing) return;
        game.processing = true;

        try {
            await this.processReply(msg, chat, game, body);
        } catch (err) {
            console.error('Erro ao processar jogada do xadrez:', err?.message || err);
        } finally {
            game.processing = false;
        }
    }

    async processReply(msg, chat, game, body) {
        const authorId = getSenderId(msg);
        if (!authorId) return;

        const text = String(body).trim();
        if (!text) return;
        const key = normalize(text);

        if (game.status === 'waiting') {
            if (JOIN_WORDS.has(key)) {
                await this.joinGame(msg, chat, game, authorId);
            }
            return;
        }

        // Quem não está jogando é ignorado em silêncio, para não poluir o grupo.
        if (authorId !== game.whiteId && authorId !== game.blackId) return;

        if (game.drawOfferBy) {
            if (authorId === game.drawOfferBy) {
                if (YES_WORDS.has(key) || NO_WORDS.has(key) || DRAW_WORDS.has(key)) {
                    await msg.reply('⏳ Aguardando a resposta do seu adversário à proposta de empate.');
                    return;
                }
            } else {
                if (YES_WORDS.has(key)) {
                    await this.finishGame(chat, game, { result: 'draw', endReason: 'agreement' });
                    return;
                }
                if (NO_WORDS.has(key)) {
                    game.drawOfferBy = null;
                    await this.persistGame(game);
                    await this.sendBoard(chat, game, { notice: '🚫 Proposta de empate recusada.' });
                    return;
                }
                // Qualquer lance legal também recusa a proposta (processMove limpa a oferta).
            }
        }

        if (RESIGN_WORDS.has(key)) {
            await this.handleResign(chat, game, authorId);
            return;
        }

        if (DRAW_WORDS.has(key)) {
            await this.handleDrawOffer(chat, game, authorId);
            return;
        }

        await this.processMove(msg, chat, game, authorId, text);
    }

    async processMove(msg, chat, game, authorId, text) {
        const chess = this.buildChess(game);
        const turnAuthorId = chess.turn() === 'w' ? game.whiteId : game.blackId;

        if (authorId !== turnAuthorId) {
            await msg.reply('⏳ Não é sua vez.');
            return;
        }

        const move = this.applyMove(chess, text);
        if (!move) {
            await msg.reply('❌ Movimento ilegal.');
            return;
        }

        game.movesSan.push(move.san);
        game.fen = chess.fen();
        game.lastMoveFrom = move.from;
        game.lastMoveTo = move.to;
        game.lastMoveAt = new Date();
        game.drawOfferBy = null;

        const moveLabel = await this.resolveLabel(authorId);
        const moveLines = [`Último lance: ${moveLabel} jogou *${move.from}→${move.to}* (${move.san})`];

        if (await this.finishIfGameOver(chat, game, chess, { moveLines, moverId: authorId })) return;

        if (this.isSolo(game)) {
            const botMove = this.playBotMove(game, chess);
            if (botMove) {
                moveLines.push(this.buildBotMoveLine(botMove));
                if (await this.finishIfGameOver(chat, game, chess, { moveLines, moverId: BOT_PLAYER_ID })) return;
            }
        }

        await this.sendBoard(chat, game, { moveLines, chess });
    }

    // Roda depois de cada lance — o do humano e o do Diogenes. Devolve true
    // quando a partida acabou e a mensagem final já foi enviada.
    async finishIfGameOver(chat, game, chess, { moveLines, moverId }) {
        if (chess.isCheckmate()) {
            await this.finishGame(chat, game, {
                result: chess.turn() === 'w' ? 'black' : 'white',
                winnerId: moverId,
                endReason: 'checkmate',
                moveLines
            });
            return true;
        }

        const drawReason = this.detectDrawReason(chess);
        if (drawReason) {
            await this.finishGame(chat, game, { result: 'draw', endReason: drawReason, moveLines });
            return true;
        }

        return false;
    }

    // Aceita coordenada ("e2 e4") e, de brinde, notação algébrica ("Cf3" não,
    // mas "Nf3" e "O-O" sim). O chess.js lança em lance inválido, daí o try.
    applyMove(chess, text) {
        const compact = text.replace(/\s+/g, ' ').trim();
        const coord = COORD_MOVE_REGEX.exec(compact);

        if (coord) {
            try {
                return chess.move({
                    from: coord[1].toLowerCase(),
                    to: coord[2].toLowerCase(),
                    promotion: (coord[3] || 'q').toLowerCase()
                });
            } catch (_) {
                return null;
            }
        }

        const candidates = [compact];
        // No celular quase ninguém digita a maiúscula da peça: "nf3" → "Nf3".
        if (/^[nbrqk]/.test(compact)) {
            candidates.push(compact[0].toUpperCase() + compact.slice(1));
        }

        for (const candidate of candidates) {
            try {
                return chess.move(candidate);
            } catch (_) {
                // tenta o próximo formato
            }
        }

        return null;
    }

    detectDrawReason(chess) {
        if (chess.isStalemate()) return 'stalemate';
        if (chess.isInsufficientMaterial()) return 'insufficient_material';
        if (chess.isThreefoldRepetition()) return 'threefold';
        if (chess.isDrawByFiftyMoves()) return 'fifty_moves';
        if (chess.isDraw()) return 'draw';
        return null;
    }

    async handleResign(chat, game, authorId) {
        const winnerId = authorId === game.whiteId ? game.blackId : game.whiteId;
        await this.finishGame(chat, game, {
            result: winnerId === game.whiteId ? 'white' : 'black',
            winnerId,
            endReason: 'resign',
            resignedBy: authorId
        });
    }

    async handleDrawOffer(chat, game, authorId) {
        game.drawOfferBy = authorId;
        await this.persistGame(game);

        if (this.isSolo(game)) {
            await this.answerDrawAsBot(chat, game);
            return;
        }

        const opponentId = authorId === game.whiteId ? game.blackId : game.whiteId;
        const label = await this.resolveLabel(authorId);

        const text = [
            `🤝 *${label}* propôs empate.`,
            '',
            `${this.mentionTag(opponentId)} responda ESTA mensagem com *sim* ou *não*.`,
            '_Fazer um lance também recusa a proposta._'
        ].join('\n');

        await this.sendRoundMessage(chat, game, { text, mentions: this.mentionsFor(opponentId) });
    }

    // O Diogenes responde na hora, no cara ou coroa.
    async answerDrawAsBot(chat, game) {
        if (Math.random() < 0.5) {
            await this.finishGame(chat, game, { result: 'draw', endReason: 'agreement' });
            return;
        }

        game.drawOfferBy = null;
        await this.persistGame(game);
        await this.sendBoard(chat, game, { notice: `🤖 ${BOT_LABEL} recusou o empate.` });
    }

    // --- Envio de mensagens --------------------------------------------------

    // O Diogenes não tem JID, então vira negrito em vez de menção.
    mentionTag(authorId) {
        if (this.isBot(authorId)) return `*${BOT_LABEL}*`;
        return `@${String(authorId || '').split('@')[0]}`;
    }

    async renderGameImage(game, chess) {
        const position = chess || this.buildChess(game);
        const buffer = await renderBoard({
            fen: position.fen(),
            lastMove: game.lastMoveFrom && game.lastMoveTo
                ? { from: game.lastMoveFrom, to: game.lastMoveTo }
                : null,
            checkSquare: position.inCheck() ? findKingSquare(position, position.turn()) : null
        });
        return new MessageMedia('image/png', buffer.toString('base64'), 'xadrez.png');
    }

    async buildActiveCaption(game, chess, { moveLines = [], notice = null, justStarted = false } = {}) {
        const whiteLabel = await this.resolveLabel(game.whiteId);
        const blackLabel = await this.resolveLabel(game.blackId);
        const turnAuthorId = chess.turn() === 'w' ? game.whiteId : game.blackId;

        const lines = [
            `♟️ *Xadrez* — Jogada ${chess.moveNumber()}`,
            '',
            `⚪ Brancas: ${whiteLabel}`,
            `⚫ Pretas: ${blackLabel}`
        ];

        if (justStarted) {
            lines.push('', '🎲 As cores foram sorteadas. As brancas começam.');
        }

        if (notice) lines.push('', notice);
        if (moveLines.length) lines.push('', ...moveLines);
        if (chess.inCheck()) lines.push('', '⚠️ *XEQUE!*');

        lines.push(
            '',
            `${this.mentionTag(turnAuthorId)} sua vez! Responda ESTA imagem com o movimento (ex.: e2 e4).`,
            '_Também vale responder *desistir* ou *empate*._'
        );

        return { text: lines.join('\n'), mentions: this.mentionsFor(turnAuthorId) };
    }

    async buildWaitingCaption(game) {
        const label = await this.resolveLabel(game.player1Id);
        return {
            text: [
                '♟️ *Xadrez* — jogo iniciado',
                '',
                `Jogador 1: ${label}`,
                'Jogador 2: _aguardando..._',
                '',
                'Responda ESTA imagem com *xadrez* para entrar na partida.'
            ].join('\n'),
            mentions: []
        };
    }

    async sendBoard(chat, game, options = {}) {
        try {
            const chess = options.chess || this.buildChess(game);
            const { text, mentions } = game.status === 'waiting'
                ? await this.buildWaitingCaption(game)
                : await this.buildActiveCaption(game, chess, options);

            const media = await this.renderGameImage(game, chess);
            await this.sendRoundMessage(chat, game, { text, media, mentions });
        } catch (err) {
            console.error('Erro ao enviar tabuleiro do xadrez:', err?.message || err);
        }
    }

    // Toda mensagem que espera resposta passa por aqui: é o que mantém o
    // `currentRoundMessageId` apontando para o alvo certo.
    async sendRoundMessage(chat, game, { text, media = null, mentions = [] }) {
        try {
            const sent = media
                ? await chat.sendMessage(media, { caption: text, mentions })
                : await chat.sendMessage(text, { mentions });

            const sentId = sent?.id?._serialized || sent?.id?.id || null;
            if (sentId) {
                game.currentRoundMessageId = sentId;
                game.roundMessageIds.push(sentId);
            }
            await this.persistGame(game);
        } catch (err) {
            console.error('Erro ao enviar mensagem da partida de xadrez:', err?.message || err);
        }
    }

    // --- Fim de partida ------------------------------------------------------

    async finishGame(chat, game, { result, winnerId = null, endReason, moveLines = [], resignedBy = null }) {
        game.status = 'finished';
        game.result = result;
        game.winnerId = winnerId;
        game.endReason = endReason;
        game.drawOfferBy = null;
        game.finishedAt = new Date();

        await this.persistGame(game);

        const scored = game.movesSan.length >= MIN_MOVES_FOR_POINTS;
        if (scored) {
            await this.finalizeScores(game);
        }

        const whiteLabel = await this.resolveLabel(game.whiteId);
        const blackLabel = await this.resolveLabel(game.blackId);

        const lines = ['♟️ *Xadrez* — fim de jogo', ''];

        if (result === 'draw') {
            lines.push(`🤝 *Empate* — ${DRAW_REASON_LABELS[endReason] || 'empate'}.`);
        } else {
            const loserId = winnerId === game.whiteId ? game.blackId : game.whiteId;
            if (endReason === 'resign') {
                const resignLabel = await this.resolveLabel(resignedBy || loserId);
                lines.push(`🏳️ *${resignLabel}* desistiu.`);
            } else {
                lines.push('♚ *Xeque-mate!*');
            }
            lines.push(`🏆 ${this.mentionTag(winnerId)} venceu!`);
        }

        lines.push(
            '',
            `⚪ Brancas: ${whiteLabel}`,
            `⚫ Pretas: ${blackLabel}`,
            `Lances: ${game.movesSan.length}`
        );

        if (moveLines.length) lines.push(...moveLines);

        lines.push('', '🏆 *Pontos:*');
        if (!scored) {
            lines.push(`ℹ️ Partida curta demais (menos de ${MIN_MOVES_FOR_POINTS} lances): nenhum ponto computado.`);
        } else if (result === 'draw') {
            lines.push(`${whiteLabel} +${POINTS_DRAW} · ${blackLabel} +${POINTS_DRAW}`);
        } else {
            const winnerLabel = winnerId === game.whiteId ? whiteLabel : blackLabel;
            const loserLabel = winnerId === game.whiteId ? blackLabel : whiteLabel;
            lines.push(`${winnerLabel} +${POINTS_WIN} · ${loserLabel} +0`);
        }

        const mentions = result === 'draw'
            ? this.mentionsFor([game.whiteId, game.blackId])
            : this.mentionsFor(winnerId);

        try {
            const media = await this.renderGameImage(game);
            await chat.sendMessage(media, { caption: lines.join('\n'), mentions });
        } catch (err) {
            console.error('Erro ao enviar resultado do xadrez:', err?.message || err);
            try {
                await chat.sendMessage(lines.join('\n'), { mentions });
            } catch (_) {}
        }

        this.activeGamesByChat.delete(game.chatId);
    }

    async finalizeScores(game) {
        const isDraw = game.result === 'draw';
        const entries = [game.whiteId, game.blackId].filter(Boolean).map((authorId) => {
            const won = !isDraw && authorId === game.winnerId;
            return {
                authorId,
                points: isDraw ? POINTS_DRAW : (won ? POINTS_WIN : 0),
                won,
                drew: isDraw,
                lost: !isDraw && !won
            };
        });

        for (const entry of entries) {
            try {
                await prisma.gameScore.upsert({
                    where: {
                        chatId_authorId_gameType: {
                            chatId: game.chatId,
                            authorId: entry.authorId,
                            gameType: 'xadrez'
                        }
                    },
                    create: {
                        chatId: game.chatId,
                        authorId: entry.authorId,
                        gameType: 'xadrez',
                        totalPoints: entry.points,
                        wins: entry.won ? 1 : 0,
                        draws: entry.drew ? 1 : 0,
                        losses: entry.lost ? 1 : 0,
                        matchesPlayed: 1
                    },
                    update: {
                        totalPoints: { increment: entry.points },
                        wins: entry.won ? { increment: 1 } : undefined,
                        draws: entry.drew ? { increment: 1 } : undefined,
                        losses: entry.lost ? { increment: 1 } : undefined,
                        matchesPlayed: { increment: 1 }
                    }
                });
            } catch (err) {
                console.error('Erro ao atualizar pontuação do xadrez:', err?.message || err);
            }
        }
    }

    // --- Expiração -----------------------------------------------------------

    async sweepExpired() {
        const now = Date.now();

        for (const [chatId, game] of [...this.activeGamesByChat.entries()]) {
            if (game.processing) continue;

            const reference = game.status === 'waiting'
                ? game.createdAt
                : (game.lastMoveAt || game.createdAt);
            const limit = game.status === 'waiting' ? WAIT_TIMEOUT_MS : MOVE_TIMEOUT_MS;
            const elapsed = now - new Date(reference || now).getTime();
            if (elapsed <= limit) continue;

            game.status = 'expired';
            game.result = 'expired';
            game.endReason = game.player2Id ? 'inactivity' : 'no_opponent';
            game.finishedAt = new Date();

            await this.persistGame(game);
            this.activeGamesByChat.delete(chatId);

            const text = game.endReason === 'no_opponent'
                ? '⌛ A partida de xadrez expirou por falta de adversário.'
                : '⌛ Partida de xadrez encerrada por inatividade. Nenhum ponto foi computado.';

            try {
                await this.client?.sendMessage(chatId, text);
            } catch (err) {
                console.error('Erro ao avisar expiração do xadrez:', err?.message || err);
            }
        }
    }

    // --- Auxiliares ----------------------------------------------------------

    async resolveLabel(authorId) {
        const fallback = String(authorId || '').split('@')[0];
        if (!authorId) return fallback;
        if (this.isBot(authorId)) return BOT_LABEL;
        if (this.labelCache.has(authorId)) return this.labelCache.get(authorId);
        if (!this.client) return fallback;

        try {
            const contact = await this.client.getContactById(authorId);
            const label = contact?.pushname || contact?.name || contact?.number || fallback;
            this.labelCache.set(authorId, label);
            return label;
        } catch (_) {
            return fallback;
        }
    }

    async persistGame(game) {
        try {
            await prisma.gameXadrez.update({
                where: { id: game.id },
                data: {
                    status: game.status,
                    player2Id: game.player2Id,
                    whiteId: game.whiteId,
                    blackId: game.blackId,
                    fen: game.fen,
                    movesSan: JSON.stringify(game.movesSan),
                    lastMoveFrom: game.lastMoveFrom,
                    lastMoveTo: game.lastMoveTo,
                    drawOfferBy: game.drawOfferBy,
                    currentRoundMessageId: game.currentRoundMessageId,
                    roundMessageIds: JSON.stringify(game.roundMessageIds),
                    result: game.result,
                    winnerId: game.winnerId,
                    endReason: game.endReason,
                    lastMoveAt: game.lastMoveAt || null,
                    finishedAt: game.finishedAt || null
                }
            });
        } catch (err) {
            console.error('Erro ao persistir partida de xadrez:', err?.message || err);
        }
    }
}

module.exports = XadrezGame;
