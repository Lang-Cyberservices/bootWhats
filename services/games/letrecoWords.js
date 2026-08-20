// Normalização e pontuação das letras do /letreco.
//
// Módulo puro, sem Prisma e sem WhatsApp: é o que permite rodar
// `node tools/letreco_preview.js --rules` sem banco nem sessão.
const TILE_TO_CHAR = { correct: 'C', present: 'P', absent: 'A' };
const CHAR_TO_TILE = { C: 'correct', P: 'present', A: 'absent' };

// "  São   Tomé " → "SAO TOME". Hífen e apóstrofo viram separador de palavra;
// tudo que não for letra A-Z some, então emoji e pontuação nunca entram no jogo.
function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[-–—'’`]/g, ' ')
        .replace(/[^A-Z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// "São Tomé" → "SAOTOME": é sobre isso que a comparação e a contagem rodam.
function extractLetters(value) {
    return normalizeText(value).replace(/\s/g, '');
}

// "COSTA RICA" → [5, 4]
function wordLengths(value) {
    return normalizeText(value).split(' ').filter(Boolean).map((word) => word.length);
}

// Duas passagens: primeiro os verdes, que consomem a ocorrência na resposta;
// só o que sobra pode virar amarelo. Sem isso, "AAAA" contra "CASA" pintaria
// quatro casas quando a resposta só tem dois "A".
function scoreGuess(target, guess) {
    const targetLetters = Array.from(String(target || ''));
    const guessLetters = Array.from(String(guess || ''));
    const result = new Array(guessLetters.length).fill('absent');
    const remaining = new Map();

    for (let i = 0; i < targetLetters.length; i++) {
        if (guessLetters[i] === targetLetters[i]) {
            result[i] = 'correct';
        } else {
            const letter = targetLetters[i];
            remaining.set(letter, (remaining.get(letter) || 0) + 1);
        }
    }

    for (let i = 0; i < guessLetters.length; i++) {
        if (result[i] === 'correct') continue;
        const letter = guessLetters[i];
        const available = remaining.get(letter) || 0;
        if (available > 0) {
            result[i] = 'present';
            remaining.set(letter, available - 1);
        }
    }

    return result;
}

// As cores viram uma string curta ("CPAAC") para caber no JSON da partida.
function tilesToChars(tiles) {
    return (tiles || []).map((tile) => TILE_TO_CHAR[tile] || 'A').join('');
}

function charsToTiles(chars) {
    return Array.from(String(chars || '')).map((ch) => CHAR_TO_TILE[ch] || 'absent');
}

module.exports = {
    normalizeText,
    extractLetters,
    wordLengths,
    scoreGuess,
    tilesToChars,
    charsToTiles
};
