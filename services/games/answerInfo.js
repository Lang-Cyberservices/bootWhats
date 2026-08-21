// Busca o significado/sinopse/descrição de uma resposta de jogo (país, filme
// ou palavra de dicionário) para revelar ao final da partida.
//
// Compartilhado entre /forca e /letreco: ambos sorteiam respostas das mesmas
// tabelas (Dictionary, Movie, Country) e revelam o significado ao terminar.
const { MessageMedia } = require('whatsapp-web.js');
const { prisma } = require('../database');
const { siglaToFlagEmoji } = require('../countryUtils');

function sanitizeDescription(text, maxLen = 700) {
    if (!text) return '';
    const clean = String(text).replace(/\s+/g, ' ').replace(/\u0000/g, '').trim();
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

async function buildCountryInfo(name, sigla) {
    try {
        const country = sigla
            ? await prisma.country.findUnique({ where: { sigla } })
            : await prisma.country.findFirst({ where: { name } });

        if (!country) return `🌍 *${name}*\n\nDescrição indisponível.`;

        const flagEmoji = siglaToFlagEmoji(country.sigla);
        const description = sanitizeDescription(country.description, 1000) || 'Sem descrição disponível.';
        return `${flagEmoji} *${country.name}* ${flagEmoji}\n\n${description}`;
    } catch (err) {
        console.error('Erro ao buscar descrição do país:', err?.message || err);
        return `🌍 *${name}*\n\nDescrição indisponível.`;
    }
}

async function buildDictionaryInfo(word) {
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
        console.error('Erro ao buscar definição do dicionário:', err?.message || err);
        return `📖 *${word}*\n\nDefinição indisponível.`;
    }
}

async function buildMovieMessage(themoviedbId, fallbackName) {
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
        const overview = sanitizeDescription(movie?.overview) || 'Sem sinopse disponível.';

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
                console.error('Erro ao baixar capa do filme:', err?.message || err);
                media = null;
            }
        }

        return { caption, media };
    } catch (err) {
        console.error('Erro ao buscar detalhes do filme:', err?.message || err);
        return { caption: `🎬 ${fallbackName}`, media: null };
    }
}

module.exports = {
    sanitizeDescription,
    buildCountryInfo,
    buildDictionaryInfo,
    buildMovieMessage
};
