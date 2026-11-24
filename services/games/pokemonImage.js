// Renderiza as imagens do /pokemon com node-canvas: a silhueta da rodada e a revelação no fim.
//
// O módulo é puro: recebe o PNG do sprite e devolve um Buffer PNG. Nada aqui depende do Prisma
// nem do WhatsApp, então dá para testar isolado com `node tools/pokemon_preview.js`.
const { createCanvas, loadImage } = require('canvas');

const CANVAS_SIZE = 800;
const PADDING = 70;
const SILHOUETTE_COLOR = '#151515';
const BACKGROUND_INNER = '#FFFFFF';
const BACKGROUND_OUTER = '#C9D6E8';

// Os sprites HOME vêm num quadro de 512×512 com bastante espaço vazio (sobretudo em cima), o que
// deixava o Pokémon baixo e descentralizado. Recorta pela área dos pixels com alfa > 0.
function visibleBounds(image) {
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height);

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] === 0) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX < 0) return { x: 0, y: 0, width, height };
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function drawBackground(ctx) {
    const center = CANVAS_SIZE / 2;
    const gradient = ctx.createRadialGradient(center, center, 50, center, center, CANVAS_SIZE * 0.7);
    gradient.addColorStop(0, BACKGROUND_INNER);
    gradient.addColorStop(1, BACKGROUND_OUTER);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
}

async function renderFrame(spriteBuffer, { silhouette }) {
    const image = await loadImage(spriteBuffer);
    const bounds = visibleBounds(image);

    const available = CANVAS_SIZE - 2 * PADDING;
    const scale = Math.min(available / bounds.width, available / bounds.height);
    const width = bounds.width * scale;
    const height = bounds.height * scale;

    // O sprite vai para um canvas próprio para o `source-in` pintar só ele, não o fundo.
    const layer = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const layerCtx = layer.getContext('2d');
    layerCtx.drawImage(
        image,
        bounds.x, bounds.y, bounds.width, bounds.height,
        (CANVAS_SIZE - width) / 2, (CANVAS_SIZE - height) / 2, width, height
    );
    if (silhouette) {
        layerCtx.globalCompositeOperation = 'source-in';
        layerCtx.fillStyle = SILHOUETTE_COLOR;
        layerCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }

    const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
    const ctx = canvas.getContext('2d');
    drawBackground(ctx);
    ctx.drawImage(layer, 0, 0);
    return canvas.toBuffer('image/png');
}

function renderSilhouette(spriteBuffer) {
    return renderFrame(spriteBuffer, { silhouette: true });
}

function renderReveal(spriteBuffer) {
    return renderFrame(spriteBuffer, { silhouette: false });
}

module.exports = { renderSilhouette, renderReveal };
