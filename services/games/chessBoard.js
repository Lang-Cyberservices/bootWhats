// Renderiza o tabuleiro de xadrez em PNG usando node-canvas.
//
// O módulo é puro: recebe um FEN (só o campo de peças importa) e devolve um
// Buffer. Nada aqui depende do chess.js nem do WhatsApp, então dá para testar
// isolado com `node tools/xadrez_preview.js`.
const path = require('node:path');
const { createCanvas, loadImage } = require('canvas');

const SQUARE = 90;
const MARGIN = 34;
const BOARD_SIZE = SQUARE * 8;
const CANVAS_SIZE = BOARD_SIZE + (MARGIN * 2);
const PIECE_SCALE = 0.86;

const COLORS = {
    margin: '#302E2B',
    marginText: '#E8E6E3',
    light: '#EEEED2',
    dark: '#769656',
    lastMove: 'rgba(246, 246, 105, 0.55)',
    check: 'rgba(216, 61, 45, 0.75)',
    border: '#1F1D1B'
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECES_DIR = path.join(__dirname, '..', '..', 'storage', 'xadrez', 'pieces');

// Sprites são lidos do disco uma única vez por processo.
const spriteCache = new Map();

async function loadPiece(code) {
    if (spriteCache.has(code)) return spriteCache.get(code);
    const image = await loadImage(path.join(PIECES_DIR, `${code}.png`));
    spriteCache.set(code, image);
    return image;
}

// "rnbqkbnr/pppppppp/8/..." → matriz [linha 8 → linha 1][coluna a → h] com
// null ou o código do sprite ("wK", "bP", ...).
function parseFenPlacement(fen) {
    const placement = String(fen || '').trim().split(/\s+/)[0] || '';
    const rows = placement.split('/');
    const board = [];

    for (let rank = 0; rank < 8; rank++) {
        const cells = new Array(8).fill(null);
        let file = 0;
        for (const ch of rows[rank] || '') {
            if (/\d/.test(ch)) {
                file += Number(ch);
                continue;
            }
            if (file > 7) break;
            const color = ch === ch.toUpperCase() ? 'w' : 'b';
            cells[file] = `${color}${ch.toUpperCase()}`;
            file += 1;
        }
        board.push(cells);
    }

    return board;
}

// "e4" → { col: 4, row: 4 } no sistema de desenho (linha 0 = rank 8, brancas embaixo).
function squareToXY(square) {
    const text = String(square || '').toLowerCase();
    const col = FILES.indexOf(text[0]);
    const rank = Number(text[1]);
    if (col < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) return null;
    return { col, row: 8 - rank };
}

function squareOrigin({ col, row }) {
    return { x: MARGIN + (col * SQUARE), y: MARGIN + (row * SQUARE) };
}

function drawCoordinates(ctx) {
    ctx.fillStyle = COLORS.marginText;
    ctx.font = `bold ${Math.round(MARGIN * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let col = 0; col < 8; col++) {
        const x = MARGIN + (col * SQUARE) + (SQUARE / 2);
        ctx.fillText(FILES[col], x, MARGIN / 2);
        ctx.fillText(FILES[col], x, CANVAS_SIZE - (MARGIN / 2));
    }

    for (let row = 0; row < 8; row++) {
        const y = MARGIN + (row * SQUARE) + (SQUARE / 2);
        const label = String(8 - row);
        ctx.fillText(label, MARGIN / 2, y);
        ctx.fillText(label, CANVAS_SIZE - (MARGIN / 2), y);
    }
}

/**
 * @param {object} options
 * @param {string} options.fen        Posição (só o primeiro campo é usado).
 * @param {{from: string, to: string}} [options.lastMove] Casas a destacar em amarelo.
 * @param {string} [options.checkSquare] Casa do rei em xeque, destacada em vermelho.
 * @returns {Promise<Buffer>} PNG do tabuleiro.
 */
async function renderBoard({ fen, lastMove = null, checkSquare = null } = {}) {
    const board = parseFenPlacement(fen);
    const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = COLORS.margin;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    drawCoordinates(ctx);

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const { x, y } = squareOrigin({ col, row });
            ctx.fillStyle = (row + col) % 2 === 0 ? COLORS.light : COLORS.dark;
            ctx.fillRect(x, y, SQUARE, SQUARE);
        }
    }

    for (const square of [lastMove?.from, lastMove?.to]) {
        const pos = square ? squareToXY(square) : null;
        if (!pos) continue;
        const { x, y } = squareOrigin(pos);
        ctx.fillStyle = COLORS.lastMove;
        ctx.fillRect(x, y, SQUARE, SQUARE);
    }

    const checkPos = checkSquare ? squareToXY(checkSquare) : null;
    if (checkPos) {
        const { x, y } = squareOrigin(checkPos);
        const cx = x + (SQUARE / 2);
        const cy = y + (SQUARE / 2);
        const gradient = ctx.createRadialGradient(cx, cy, SQUARE * 0.1, cx, cy, SQUARE * 0.62);
        gradient.addColorStop(0, COLORS.check);
        gradient.addColorStop(1, 'rgba(216, 61, 45, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, SQUARE, SQUARE);
    }

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(MARGIN - 1, MARGIN - 1, BOARD_SIZE + 2, BOARD_SIZE + 2);

    const pieceSize = Math.round(SQUARE * PIECE_SCALE);
    const offset = Math.round((SQUARE - pieceSize) / 2);

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const code = board[row]?.[col];
            if (!code) continue;
            const image = await loadPiece(code);
            const { x, y } = squareOrigin({ col, row });
            ctx.drawImage(image, x + offset, y + offset, pieceSize, pieceSize);
        }
    }

    return canvas.toBuffer('image/png');
}

module.exports = {
    renderBoard,
    parseFenPlacement,
    CANVAS_SIZE
};
