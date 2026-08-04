// Conversão entre sigla ISO-2 (BR) e emoji de bandeira (🇧🇷).
// O emoji é formado por dois "regional indicator symbols", que ficam 127397
// posições acima das letras maiúsculas correspondentes na tabela Unicode.

function siglaToFlagEmoji(sigla) {
    return String(sigla || '').toUpperCase().replace(/./g, (char) => {
        const code = char.charCodeAt(0);
        if (code < 65 || code > 90) return char;
        return String.fromCodePoint(127397 + code);
    });
}

function extractSiglaFromFlagEmoji(input) {
    const codePoints = Array.from(String(input || '').trim());
    if (codePoints.length !== 2) return null;

    const letters = codePoints.map((char) => {
        const codePoint = char.codePointAt(0);
        if (codePoint < 0x1F1E6 || codePoint > 0x1F1FF) return null;
        return String.fromCharCode(codePoint - 127397);
    });

    return letters.every(Boolean) ? letters.join('') : null;
}

module.exports = { siglaToFlagEmoji, extractSiglaFromFlagEmoji };
