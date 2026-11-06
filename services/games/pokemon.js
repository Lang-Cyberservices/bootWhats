const { MessageMedia } = require('whatsapp-web.js');
const { prisma } = require('../database');
const { getSenderId } = require('../messageUtils');
const { renderSilhouette, renderReveal } = require('./pokemonImage');
const {
    GENERATION_RANGES,
    randomId,
    getPokemon,
    fetchSprite,
    isCorrectGuess,
    nameLetters,
    maskName,
    pokemonFactsLine,
    pokemonDescription,
    formatDexNumber
} = require('./pokemonData');

// A cada WRONG_GUESSES_PER_HINT chutes errados sai uma dica; cada dica tira HINT_PENALTY do prêmio.
const WRONG_GUESSES_PER_HINT = 3;
const MAX_HINT_LEVEL = 3;
const BASE_POINTS = 10;
const HINT_PENALTY = 2;
const RECENT_WRONG_GUESSES_SHOWN = 6;

// Segura quem tenta queimar as dicas mandando chutes em sequência.
const SAME_PLAYER_COOLDOWN_MS = Number(process.env.POKEMON_COOLDOWN_MS) || 15_000;
const POKEMON_TIMEOUT_MS = Number(process.env.POKEMON_TIMEOUT_MS) || 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

const END_WORDS = new Set(['encerrar', 'encerra', 'parar', 'cancelar', 'desistir', 'fim']);

const USAGE_MESSAGE =
    'Opção inválida.\n\n' +
    'Use:\n' +
    '• /pokemon — sorteia entre todos os Pokémon\n' +
    '• /pokemon 1 (até 9) — só daquela geração\n' +
    '• /pokemon encerrar — encerra a partida atual';

function normalize(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
        return fallback;
    }
}

class PokemonGame {
    constructor({ errorLogger = null } = {}) {
        this.activeGamesByChat = new Map();
        this.labelCache = new Map();
        this.spriteCache = new Map();
        this.errorLogger = errorLogger;
        this.client = null;
        this.sweepTimer = null;
    }

    setClient(client) {
        this.client = client;
    }

    async loadActiveGames() {
        if (!prisma?.gamePokemon) {
            console.warn('Aviso: prisma.gamePokemon indisponível. /pokemon desativado até rodar migrate/generate.');
            return;
        }

        try {
            const rows = await prisma.gamePokemon.findMany({
                where: { status: 'active' },
                include: { pokemon: true }
            });

            for (const row of rows) {
                this.activeGamesByChat.set(row.chatId, this.rowToState(row));
            }

            if (rows.length) {
                console.log(`❓ Pokémon: ${rows.length} partida(s) ativa(s) recarregada(s) após reinício.`);
            }
        } catch (err) {
            console.error('Erro ao carregar partidas ativas do pokemon:', err?.message || err);
        }

        this.startSweepTimer();
    }

    startSweepTimer() {
        if (this.sweepTimer) return;
        this.sweepTimer = setInterval(() => {
            this.sweepExpired().catch((err) =>
                console.error('Erro ao expirar partidas de pokemon:', err?.message || err)
            );
        }, SWEEP_INTERVAL_MS);
        this.sweepTimer.unref?.();
    }

    rowToState(row) {
        return {
            id: row.id,
            chatId: row.chatId,
            status: row.status,
            pokemon: row.pokemon,
            hintLevel: row.hintLevel,
            wrongGuesses: parseJson(row.wrongGuesses, []),
            lastGuessByAuthor: parseJson(row.lastGuessByAuthor, {}),
            currentRoundMessageId: row.currentRoundMessageId,
            roundMessageIds: parseJson(row.roundMessageIds, []),
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

    // --- Início de partida -------------------------------------------------

    async startGame(msg, chat, args) {
        const chatId = this.getChatId(chat);
        if (!chatId) return;

        const authorId = getSenderId(msg) || 'unknown';
        const arg = normalize(String(args?.[0] || ''));

        if (END_WORDS.has(arg)) {
            await this.handleEndRequest(msg, chat, chatId, authorId);
            return;
        }

        const existing = this.activeGamesByChat.get(chatId);
        if (existing) {
            await msg.reply('❓ Já existe um "Quem é esse Pokémon?" em andamento neste grupo! Reenviando a rodada atual...');
            await this.sendRound(chat, existing);
            return;
        }

        let generation = null;
        if (arg) {
            const parsed = Number(arg.replace(/(a|ª|o|º)$/, ''));
            if (!GENERATION_RANGES[parsed]) {
                await msg.reply(USAGE_MESSAGE);
                return;
            }
            generation = parsed;
        }

        let pokemon;
        let sprite;
        try {
            pokemon = await getPokemon(randomId(generation), { errorLogger: this.errorLogger });
            sprite = await this.getSprite(pokemon);
        } catch (err) {
            console.error('Erro ao buscar Pokémon:', err?.message || err);
            this.errorLogger?.logError(err, { process: 'bot', context: 'command./pokemon' });
            await msg.reply('❌ Não consegui buscar um Pokémon agora, tente novamente.');
            return;
        }

        // Outro /pokemon pode ter começado enquanto a PokeAPI respondia.
        if (this.activeGamesByChat.has(chatId)) return;

        let row;
        try {
            row = await prisma.gamePokemon.create({
                data: {
                    chatId,
                    status: 'active',
                    pokemonId: pokemon.id,
                    wrongGuesses: '[]',
                    lastGuessByAuthor: '{}',
                    roundMessageIds: '[]',
                    startedBy: authorId
                },
                include: { pokemon: true }
            });
        } catch (err) {
            console.error('Erro ao criar partida de pokemon:', err?.message || err);
            await msg.reply('❌ Não consegui iniciar o jogo agora.');
            return;
        }

        const game = this.rowToState(row);
        this.activeGamesByChat.set(chatId, game);

        await this.sendRound(chat, game, sprite);
    }

    async handleEndRequest(msg, chat, chatId, authorId) {
        const game = this.activeGamesByChat.get(chatId);
        if (!game) {
            await msg.reply('Não existe um "Quem é esse Pokémon?" ativo neste chat.\n\nUse */pokemon* para iniciar.');
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

        await this.sendReveal(chat, game, { header: '❓ *Partida encerrada.*' });
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

    // O sprite não fica no banco, só a URL; o cache evita baixar de novo a cada dica.
    async getSprite(pokemon) {
        const cached = this.spriteCache.get(pokemon.id);
        if (cached) return cached;

        const buffer = await fetchSprite(pokemon.imageUrl);
        this.spriteCache.set(pokemon.id, buffer);
        return buffer;
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
        // O chute não depende do estado da rodada, então vale reply a qualquer imagem da partida.
        if (!quotedId || !game.roundMessageIds.includes(quotedId)) return;

        if (game.processing) return;
        game.processing = true;

        try {
            await this.processGuess(msg, chat, game, body.trim());
        } catch (err) {
            console.error('Erro ao processar chute do pokemon:', err?.message || err);
        } finally {
            game.processing = false;
        }
    }

    async processGuess(msg, chat, game, guess) {
        if (!guess) return;

        const authorId = getSenderId(msg);
        if (!authorId) return;

        const lastAt = Number(game.lastGuessByAuthor[authorId]) || 0;
        const allowedAt = lastAt + SAME_PLAYER_COOLDOWN_MS;
        if (Date.now() < allowedAt) {
            const seconds = Math.ceil((allowedAt - Date.now()) / 1000);
            await msg.reply(`⏳ Calma! Você pode chutar de novo em ${seconds} segundos.`);
            return;
        }
        game.lastGuessByAuthor[authorId] = Date.now();

        if (isCorrectGuess(guess, game.pokemon)) {
            await this.finishGame(chat, game, authorId);
            return;
        }

        const label = await this.resolveLabel(authorId);
        game.wrongGuesses.push({ authorId, guess, label });

        const reachedHint = Math.min(
            MAX_HINT_LEVEL,
            Math.floor(game.wrongGuesses.length / WRONG_GUESSES_PER_HINT)
        );
        if (reachedHint > game.hintLevel) {
            game.hintLevel = reachedHint;
            await this.sendRound(chat, game);
            return;
        }

        await this.persistGame(game);
        // Reação em vez de resposta: um "não é esse" por chute inundaria o grupo.
        try {
            await msg.react('❌');
        } catch (_) {}
    }

    // --- Rodada --------------------------------------------------------------

    buildHintLines(game) {
        const { pokemon } = game;
        const lines = [];

        if (game.hintLevel >= 1) {
            const typeLabel = pokemon.types.includes('/') ? 'Tipos' : 'Tipo';
            lines.push(`💡 Geração: ${pokemon.generation}ª · ${typeLabel}: ${pokemon.types}`);
        }

        if (game.hintLevel >= 2) {
            const letters = nameLetters(pokemon.name);
            lines.push(
                `💡 ${letters.length} letras, começa com ${letters[0]} e termina com ${letters[letters.length - 1]}`
            );
        }

        if (game.hintLevel >= 3) {
            const description = pokemonDescription(pokemon);
            if (description) lines.push(`💡 "${maskName(description, pokemon)}"`);
        }

        return lines;
    }

    buildRoundText(game) {
        const lines = ['❓ *Quem é esse Pokémon?*'];

        const hints = this.buildHintLines(game);
        if (hints.length) lines.push('', ...hints);

        const recent = game.wrongGuesses.slice(-RECENT_WRONG_GUESSES_SHOWN);
        if (recent.length) {
            lines.push('', '💀 *Chutes errados:*', ...recent.map((g) => `${g.label} → ${g.guess}`));
        }

        const prize = this.currentPrize(game);
        lines.push(
            '',
            'Responda ESTA imagem com o nome do Pokémon.',
            `Prêmio atual: ${prize} pontos. A cada ${WRONG_GUESSES_PER_HINT} chutes errados sai uma dica e o prêmio cai.`
        );

        return lines.join('\n');
    }

    currentPrize(game) {
        return BASE_POINTS - HINT_PENALTY * game.hintLevel;
    }

    // Funil único de envio da silhueta: é aqui que a rodada atual passa a valer.
    async sendRound(chat, game, sprite = null) {
        try {
            const buffer = await renderSilhouette(sprite || await this.getSprite(game.pokemon));
            const media = new MessageMedia('image/png', buffer.toString('base64'), 'pokemon.png');
            const sent = await chat.sendMessage(media, { caption: this.buildRoundText(game) });
            const sentId = sent?.id?._serialized || sent?.id?.id || null;
            if (sentId) {
                game.currentRoundMessageId = sentId;
                game.roundMessageIds.push(sentId);
            }
        } catch (err) {
            console.error('Erro ao enviar rodada do pokemon:', err?.message || err);
        }
        await this.persistGame(game);
    }

    // --- Fim de partida ------------------------------------------------------

    buildRevealText(game, header) {
        const { pokemon } = game;
        const lines = [
            header,
            '',
            `É o *${pokemon.name}*! ${formatDexNumber(pokemon.id)}`,
            pokemonFactsLine(pokemon)
        ];

        const description = pokemonDescription(pokemon);
        if (description) lines.push('', `📖 ${description}`);

        return lines.join('\n');
    }

    async sendReveal(chat, game, { header, mentions = [] }) {
        const caption = this.buildRevealText(game, header);
        try {
            const buffer = await renderReveal(await this.getSprite(game.pokemon));
            const media = new MessageMedia('image/png', buffer.toString('base64'), 'pokemon.png');
            await chat.sendMessage(media, { caption, mentions });
        } catch (err) {
            console.error('Erro ao enviar revelação do pokemon:', err?.message || err);
            try {
                await chat.sendMessage(caption, { mentions });
            } catch (_) {}
        }
        this.spriteCache.delete(game.pokemon.id);
    }

    async finishGame(chat, game, winnerId) {
        const points = this.currentPrize(game);
        game.status = 'won';
        game.winnerId = winnerId;
        game.finishedAt = new Date();
        await this.persistGame(game);
        this.activeGamesByChat.delete(game.chatId);

        const label = await this.resolveLabel(winnerId);
        await this.sendReveal(chat, game, {
            header: `🎉 *Parabéns @${label}!* (+${points} pontos)`,
            mentions: [winnerId]
        });

        await this.saveScore(game, winnerId, points);
    }

    // Só o vencedor pontua: os chutes errados não valem nada.
    async saveScore(game, winnerId, points) {
        try {
            await prisma.gameScore.upsert({
                where: {
                    chatId_authorId_gameType: { chatId: game.chatId, authorId: winnerId, gameType: 'pokemon' }
                },
                create: {
                    chatId: game.chatId,
                    authorId: winnerId,
                    gameType: 'pokemon',
                    totalPoints: points,
                    wins: 1,
                    matchesPlayed: 1
                },
                update: {
                    totalPoints: { increment: points },
                    wins: { increment: 1 },
                    matchesPlayed: { increment: 1 }
                }
            });
        } catch (err) {
            console.error('Erro ao salvar pontuação do pokemon:', err?.message || err);
        }
    }

    // --- Expiração -----------------------------------------------------------

    async sweepExpired() {
        const now = Date.now();

        for (const [chatId, game] of [...this.activeGamesByChat.entries()]) {
            if (game.processing) continue;

            const startedMs = game.createdAt ? new Date(game.createdAt).getTime() : now;
            if (now - startedMs < POKEMON_TIMEOUT_MS) continue;

            game.status = 'expired';
            game.finishedAt = new Date();
            await this.persistGame(game);
            this.activeGamesByChat.delete(chatId);

            let chat;
            try {
                chat = await this.client?.getChatById(chatId);
            } catch (err) {
                console.error('Erro ao abrir chat para expirar pokemon:', err?.message || err);
            }
            if (!chat) continue;

            await this.sendReveal(chat, game, { header: '⌛ *Tempo esgotado! Ninguém acertou.*' });
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
        if (!prisma?.gamePokemon) return;

        try {
            await prisma.gamePokemon.update({
                where: { id: game.id },
                data: {
                    status: game.status,
                    hintLevel: game.hintLevel,
                    wrongGuesses: JSON.stringify(game.wrongGuesses),
                    lastGuessByAuthor: JSON.stringify(game.lastGuessByAuthor),
                    currentRoundMessageId: game.currentRoundMessageId,
                    roundMessageIds: JSON.stringify(game.roundMessageIds),
                    winnerId: game.winnerId,
                    finishedAt: game.finishedAt
                }
            });
        } catch (err) {
            console.error('Erro ao salvar partida de pokemon:', err?.message || err);
        }
    }
}

module.exports = PokemonGame;
