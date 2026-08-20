// Renderiza o tabuleiro do /letreco em PNG usando node-canvas.
//
// O módulo é puro: recebe o estado já normalizado (letras em A-Z, cores por
// casa) e devolve um Buffer. Nada aqui depende do Prisma nem do WhatsApp, então
// dá para testar isolado com `node tools/letreco_preview.js`.
const { createCanvas } = require('canvas');

const CANVAS_WIDTH = 1080;
const SIDE_PADDING = 40;
const HEADER_HEIGHT = 180;
const FOOTER_HEIGHT = 150;
const TILE_GAP = 10;
const WORD_GAP = 28;
const ROW_GAP = 26;
const LABEL_HEIGHT = 26;
const MIN_TILE_SIZE = 38;
const MAX_TILE_SIZE = 92;
const MAX_LABEL_CHARS = 14;

const COLORS = {
    background: '#F7F5EF',
    absent: '#D64545',
    present: '#E8B923',
    correct: '#3FAE63',
    emptyFill: '#EDEAE1',
    emptyBorder: '#A0A0A0',
    textDark: '#1A1A1A',
    textLight: '#FFFFFF',
    textMuted: '#6B675F',
    banner: '#2F2C27'
};

// Fundo amarelo pede letra preta; vermelho e verde pedem branca.
const TILE_TEXT = {
    absent: COLORS.textLight,
    present: COLORS.textDark,
    correct: COLORS.textLight
};

const CATEGORY_LABELS = {
    dicionario: 'Dicionário',
    filme: 'Filme',
    pais: 'País'
};

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function truncateLabel(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= MAX_LABEL_CHARS) return text;
    return `${text.slice(0, MAX_LABEL_CHARS - 1)}…`;
}

// Escurece a cor da casa para desenhar a borda, dando o efeito de marca-texto
// sem precisar de uma segunda paleta.
function darken(hex, factor = 0.78) {
    const value = String(hex).replace('#', '');
    const num = parseInt(value, 16);
    const r = Math.round(((num >> 16) & 255) * factor);
    const g = Math.round(((num >> 8) & 255) * factor);
    const b = Math.round((num & 255) * factor);
    return `rgb(${r}, ${g}, ${b})`;
}

function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// A largura de uma linha depende de quantas casas ela tem e de quantos espaços
// entre palavras a resposta impõe — todas as linhas usam o mesmo padrão para as
// colunas ficarem alinhadas mesmo quando o palpite separa as palavras em outro
// lugar.
function layoutFor(wordLengths, tileSize) {
    const totalLetters = wordLengths.reduce((sum, n) => sum + n, 0);
    const width = (totalLetters * tileSize)
        + ((totalLetters - wordLengths.length) * TILE_GAP)
        + ((wordLengths.length - 1) * WORD_GAP);
    return { totalLetters, width };
}

function pickTileSize(wordLengths) {
    const available = CANVAS_WIDTH - (SIDE_PADDING * 2);
    const totalLetters = wordLengths.reduce((sum, n) => sum + n, 0) || 1;
    const gaps = ((totalLetters - wordLengths.length) * TILE_GAP)
        + ((wordLengths.length - 1) * WORD_GAP);
    return clamp(Math.floor((available - gaps) / totalLetters), MIN_TILE_SIZE, MAX_TILE_SIZE);
}

function drawTile(ctx, { x, y, size, letter, status }) {
    const radius = Math.round(size * 0.18);

    if (!status) {
        ctx.fillStyle = COLORS.emptyFill;
        roundedRect(ctx, x, y, size, size, radius);
        ctx.fill();
        ctx.strokeStyle = COLORS.emptyBorder;
        ctx.lineWidth = 2;
        roundedRect(ctx, x, y, size, size, radius);
        ctx.stroke();
        return;
    }

    const fill = COLORS[status] || COLORS.absent;
    ctx.fillStyle = fill;
    roundedRect(ctx, x, y, size, size, radius);
    ctx.fill();
    ctx.strokeStyle = darken(fill);
    ctx.lineWidth = 3;
    roundedRect(ctx, x, y, size, size, radius);
    ctx.stroke();

    if (!letter) return;
    ctx.fillStyle = TILE_TEXT[status] || COLORS.textLight;
    ctx.font = `bold ${Math.round(size * 0.58)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, x + (size / 2), y + (size / 2) + 1);
}

// Distribui as letras de uma linha sobre o padrão de palavras da resposta.
function drawRow(ctx, { y, tileSize, wordLengths, letters, tiles, label }) {
    const { width } = layoutFor(wordLengths, tileSize);
    const startX = Math.round((CANVAS_WIDTH - width) / 2);
    let x = startX;
    let index = 0;

    for (const [wordIndex, length] of wordLengths.entries()) {
        for (let i = 0; i < length; i++) {
            drawTile(ctx, {
                x,
                y,
                size: tileSize,
                letter: letters ? letters[index] : null,
                status: tiles ? tiles[index] : null
            });
            index += 1;
            x += tileSize + (i === length - 1 ? 0 : TILE_GAP);
        }
        if (wordIndex < wordLengths.length - 1) x += WORD_GAP;
    }

    if (label) {
        // Alinhado à primeira casa: centralizado, o nome cairia justamente na
        // separação entre as palavras.
        ctx.fillStyle = COLORS.textMuted;
        ctx.font = `500 ${Math.round(LABEL_HEIGHT * 0.72)}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(truncateLabel(label), startX + 4, y + tileSize + 4);
    }
}

function drawLegend(ctx, y) {
    const items = [
        { status: 'correct', text: 'letra certa no lugar certo' },
        { status: 'present', text: 'letra certa no lugar errado' },
        { status: 'absent', text: 'letra que não existe' }
    ];

    const box = 22;
    ctx.textBaseline = 'middle';
    ctx.font = '20px sans-serif';

    // Os quadradinhos ficam numa coluna só: centralizar cada linha isolada
    // deixaria as três cores em posições diferentes.
    const widest = Math.max(...items.map((item) => ctx.measureText(item.text).width));
    const x = Math.round((CANVAS_WIDTH - (box + 12 + widest)) / 2);

    let cursorY = y;
    for (const item of items) {
        ctx.fillStyle = COLORS[item.status];
        roundedRect(ctx, x, cursorY - (box / 2), box, box, 5);
        ctx.fill();
        ctx.strokeStyle = darken(COLORS[item.status]);
        ctx.lineWidth = 2;
        roundedRect(ctx, x, cursorY - (box / 2), box, box, 5);
        ctx.stroke();

        ctx.fillStyle = COLORS.textMuted;
        ctx.textAlign = 'left';
        ctx.fillText(item.text, x + box + 12, cursorY);

        cursorY += 34;
    }
}

/**
 * @param {object} options
 * @param {string} options.category      'dicionario' | 'filme' | 'pais'
 * @param {string} options.status        'active' | 'won' | 'lost' | 'expired'
 * @param {number[]} options.wordLengths Tamanho de cada palavra da resposta.
 * @param {Array<{letters: string, tiles: string[], label: string}>} options.rows
 * @param {number} [options.maxAttempts]
 * @param {string} [options.answer]      Revelada no rodapé quando o jogo acaba.
 * @param {string} [options.winnerLabel]
 * @returns {Promise<Buffer>} PNG do tabuleiro.
 */
async function renderBoard({
    category = 'dicionario',
    status = 'active',
    wordLengths = [],
    rows = [],
    maxAttempts = 10,
    answer = null,
    winnerLabel = null
} = {}) {
    const lengths = wordLengths.length ? wordLengths : [5];
    const tileSize = pickTileSize(lengths);
    const active = status === 'active';
    const visibleRows = rows.length + (active ? 1 : 0);
    const rowHeight = tileSize + LABEL_HEIGHT + ROW_GAP;
    // A faixa de vitória/derrota ocupa uma altura própria, abaixo das linhas.
    const bannerHeight = active ? 0 : 130;
    const canvasHeight = HEADER_HEIGHT + (visibleRows * rowHeight) + bannerHeight + FOOTER_HEIGHT;

    const canvas = createCanvas(CANVAS_WIDTH, canvasHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeight);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textDark;
    ctx.font = 'bold 62px sans-serif';
    ctx.fillText('LETRECO', CANVAS_WIDTH / 2, 62);

    ctx.fillStyle = COLORS.textMuted;
    ctx.font = '30px sans-serif';
    ctx.fillText(
        `${CATEGORY_LABELS[category] || category}  •  Tentativas: ${rows.length}/${maxAttempts}`,
        CANVAS_WIDTH / 2,
        118
    );

    let y = HEADER_HEIGHT;
    for (const row of rows) {
        drawRow(ctx, {
            y,
            tileSize,
            wordLengths: lengths,
            letters: row.letters,
            tiles: row.tiles,
            label: row.label
        });
        y += rowHeight;
    }

    if (active) {
        drawRow(ctx, { y, tileSize, wordLengths: lengths, letters: null, tiles: null, label: null });
        y += rowHeight;
    }

    if (!active) {
        // As casas são todas em caixa alta; a resposta revelada acompanha, mas
        // mantendo os acentos da grafia do banco.
        const revealed = answer ? String(answer).toLocaleUpperCase('pt-BR') : null;
        const bannerLines = [];
        if (status === 'won') {
            bannerLines.push('VITÓRIA!');
            if (winnerLabel) {
                bannerLines.push(`${truncateLabel(winnerLabel)} acertou em ${rows.length} ${rows.length === 1 ? 'tentativa' : 'tentativas'}.`);
            }
        } else if (status === 'expired') {
            bannerLines.push('PARTIDA ENCERRADA');
            if (revealed) bannerLines.push(`A resposta era ${revealed}`);
        } else {
            bannerLines.push('FIM DE JOGO');
            if (revealed) bannerLines.push(`A resposta era ${revealed}`);
        }

        ctx.fillStyle = COLORS.banner;
        ctx.textAlign = 'center';
        ctx.font = 'bold 42px sans-serif';
        ctx.fillText(bannerLines[0], CANVAS_WIDTH / 2, y + 26);
        if (bannerLines[1]) {
            ctx.font = '28px sans-serif';
            ctx.fillText(bannerLines[1], CANVAS_WIDTH / 2, y + 74);
        }
        y += bannerHeight;
    }

    drawLegend(ctx, y + 26);

    return canvas.toBuffer('image/png');
}

module.exports = {
    renderBoard,
    CANVAS_WIDTH,
    COLORS
};
