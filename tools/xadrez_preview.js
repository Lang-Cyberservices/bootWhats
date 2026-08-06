#!/usr/bin/env node
// Ferramenta de apoio ao /xadrez: renderiza um tabuleiro sem subir o bot e
// checa as regras de fim de partida do chess.js.
//
//   node tools/xadrez_preview.js "e4 e5 Nf3 Nc6 Bb5" /tmp/board.png
//   node tools/xadrez_preview.js --fen "rnbqkbnr/..." /tmp/board.png
//   node tools/xadrez_preview.js --rules
const fs = require('node:fs/promises');
const path = require('node:path');
const { Chess } = require('chess.js');
const { renderBoard } = require('../services/games/chessBoard');

async function renderFromMoves(movesText, output) {
    const chess = new Chess();
    const moves = String(movesText || '').trim().split(/\s+/).filter(Boolean);

    // chess.move() lança em lance inválido; o catch do main() imprime o motivo.
    for (const move of moves) {
        chess.move(move);
    }

    const history = chess.history({ verbose: true });
    const last = history[history.length - 1] || null;

    const buffer = await renderBoard({
        fen: chess.fen(),
        lastMove: last ? { from: last.from, to: last.to } : null,
        checkSquare: chess.inCheck() ? findKingSquare(chess, chess.turn()) : null
    });

    await fs.writeFile(output, buffer);
    console.log(`✅ ${output} (${buffer.length} bytes)`);
    console.log(`   FEN: ${chess.fen()}`);
    console.log(`   Vez das ${chess.turn() === 'w' ? 'brancas' : 'pretas'}${chess.inCheck() ? ' — XEQUE' : ''}`);
    console.log(chess.ascii());
}

async function renderFromFen(fen, output) {
    const chess = new Chess(fen);
    const buffer = await renderBoard({
        fen: chess.fen(),
        checkSquare: chess.inCheck() ? findKingSquare(chess, chess.turn()) : null
    });
    await fs.writeFile(output, buffer);
    console.log(`✅ ${output} (${buffer.length} bytes)`);
    console.log(chess.ascii());
}

function findKingSquare(chess, color) {
    for (const row of chess.board()) {
        for (const cell of row) {
            if (cell && cell.type === 'k' && cell.color === color) return cell.square;
        }
    }
    return null;
}

function replay(moves) {
    const chess = new Chess();
    for (const move of moves) {
        chess.move(move);
    }
    return chess;
}

function assert(label, condition) {
    console.log(`${condition ? '✅' : '❌'} ${label}`);
    if (!condition) process.exitCode = 1;
}

function runRules() {
    const mate = replay(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
    assert('mate do pastor → isCheckmate()', mate.isCheckmate());
    assert('mate do pastor → isGameOver()', mate.isGameOver());
    assert('mate do pastor tem 7 lances', mate.history().length === 7);

    const check = replay(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']);
    assert('antes do mate não há xeque', !check.inCheck());

    // Tripla repetição: cavalos indo e voltando. Só é detectável porque a
    // posição é reconstruída replayando os lances — um Chess carregado a
    // partir do FEN final não teria o histórico e devolveria false.
    const repetitionMoves = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];
    const repetition = replay(repetitionMoves);
    assert('tripla repetição detectada no replay', repetition.isThreefoldRepetition());

    const fromFen = new Chess(repetition.fen());
    assert('tripla repetição NÃO é detectada só pelo FEN', !fromFen.isThreefoldRepetition());

    const stalemate = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert('afogamento → isStalemate()', stalemate.isStalemate());

    const insufficient = new Chess('7k/8/6K1/8/8/8/8/7B w - - 0 1');
    assert('rei e bispo → isInsufficientMaterial()', insufficient.isInsufficientMaterial());
}

async function main() {
    const args = process.argv.slice(2);

    if (args[0] === '--rules') {
        runRules();
        return;
    }

    if (args[0] === '--fen') {
        const fen = args[1];
        const output = path.resolve(args[2] || '/tmp/board.png');
        if (!fen) throw new Error('Uso: --fen "<FEN>" [saida.png]');
        await renderFromFen(fen, output);
        return;
    }

    const movesText = args[0] || '';
    const output = path.resolve(args[1] || '/tmp/board.png');
    await renderFromMoves(movesText, output);
}

main().catch((err) => {
    console.error('❌', err?.message || err);
    process.exit(1);
});
