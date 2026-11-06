// Dados do /pokemon: espelho local da PokeAPI na tabela `pokemons`, preenchido sob demanda.
//
// A primeira vez que um id é sorteado ele vem da PokeAPI e fica no banco; dali em diante sai só
// do banco. A descrição (flavor text) é guardada em pt-BR: da própria PokeAPI quando existe, senão
// traduzida pela Google Cloud Translation (NMT) com a mesma chave do Gemini. Se a tradução falhar a
// linha é gravada assim mesmo, com `description = null`, e só a tradução é refeita no próximo sorteio.
//
// `fetchFromPokeApi`, `normalizeName`, `maskName` e `nameLetters` não tocam o Prisma, então dá para
// testar isolado com `node tools/pokemon_preview.js`.
const { prisma } = require('../database');

const POKEAPI_BASE = 'https://pokeapi.co/api/v2';
const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other';
const TRANSLATE_ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const FETCH_TIMEOUT_MS = 15_000;

// Faixas da Pokédex nacional por geração: o sorteio por geração não precisa chamar a API.
const GENERATION_RANGES = {
    1: [1, 151],
    2: [152, 251],
    3: [252, 386],
    4: [387, 493],
    5: [494, 649],
    6: [650, 721],
    7: [722, 809],
    8: [810, 905],
    9: [906, 1025]
};
const MAX_POKEMON_ID = GENERATION_RANGES[9][1];

const ROMAN_GENERATIONS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };

const TYPE_NAMES_PT = {
    normal: 'Normal',
    fire: 'Fogo',
    water: 'Água',
    grass: 'Planta',
    electric: 'Elétrico',
    ice: 'Gelo',
    fighting: 'Lutador',
    poison: 'Venenoso',
    ground: 'Terrestre',
    flying: 'Voador',
    psychic: 'Psíquico',
    bug: 'Inseto',
    rock: 'Pedra',
    ghost: 'Fantasma',
    dragon: 'Dragão',
    dark: 'Sombrio',
    steel: 'Aço',
    fairy: 'Fada'
};

function randomId(generation = null) {
    const [min, max] = GENERATION_RANGES[generation] || [1, MAX_POKEMON_ID];
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function fetchJson(url, options = {}) {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} em ${url.split('?')[0]}: ${body.slice(0, 200)}`);
    }
    return res.json();
}

// O flavor text da PokeAPI vem com as quebras do jogo original (\n, \f) e soft hyphens.
function cleanFlavorText(text) {
    return String(text || '')
        .replace(/­\s*/g, '')
        .replace(/[\f\n\r\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// As entradas vêm em ordem de jogo, então a última de cada idioma é a mais recente.
function lastEntry(entries, language, field) {
    const matching = (entries || []).filter((e) => e?.language?.name === language && e?.[field]);
    return matching.length ? matching[matching.length - 1][field] : null;
}

function parseGeneration(name) {
    const roman = String(name || '').replace(/^generation-/, '');
    return ROMAN_GENERATIONS[roman] || null;
}

// O HOME (render 3D) é o preferido; alguns ids recentes só têm a arte oficial.
async function resolveImageUrl(id) {
    const candidates = [`${SPRITE_BASE}/home/${id}.png`, `${SPRITE_BASE}/official-artwork/${id}.png`];
    for (const url of candidates) {
        try {
            const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (res.ok) return url;
        } catch (_) {}
    }
    throw new Error(`Nenhum sprite encontrado para o Pokémon #${id}`);
}

// Lança em qualquer falha: sem a chave ou com a API bloqueada, quem chama decide o fallback.
async function translateToPtBr(texts) {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) throw new Error('GEMINI_API_KEY ausente: tradução indisponível');

    const json = await fetchJson(`${TRANSLATE_ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: texts, source: 'en', target: 'pt', model: 'nmt', format: 'text' })
    });

    const translations = json?.data?.translations;
    if (!Array.isArray(translations) || translations.length !== texts.length) {
        throw new Error('Resposta inesperada da Google Translation');
    }
    return translations.map((t) => String(t?.translatedText || '').trim());
}

// Monta a linha do espelho sem tocar o banco. A descrição pt-BR só vem preenchida aqui quando a
// PokeAPI já a tem; a tradução é responsabilidade de `fillTranslation`.
async function fetchFromPokeApi(id) {
    const [species, pokemon] = await Promise.all([
        fetchJson(`${POKEAPI_BASE}/pokemon-species/${id}`),
        fetchJson(`${POKEAPI_BASE}/pokemon/${id}`)
    ]);

    const name = lastEntry(species.names, 'en', 'name') || species.name;
    const types = (pokemon.types || [])
        .sort((a, b) => a.slot - b.slot)
        .map((t) => TYPE_NAMES_PT[t?.type?.name] || t?.type?.name)
        .join('/');

    const descriptionPt = lastEntry(species.flavor_text_entries, 'pt-br', 'flavor_text');
    const genusPt = lastEntry(species.genera, 'pt-br', 'genus');

    return {
        id,
        name,
        slug: species.name,
        generation: parseGeneration(species.generation?.name) || 0,
        types,
        genus: genusPt || lastEntry(species.genera, 'en', 'genus'),
        genusIsPt: Boolean(genusPt),
        descriptionEn: cleanFlavorText(lastEntry(species.flavor_text_entries, 'en', 'flavor_text')) || null,
        description: descriptionPt ? cleanFlavorText(descriptionPt) : null,
        descriptionSource: descriptionPt ? 'pokeapi' : null,
        imageUrl: await resolveImageUrl(id),
        heightDm: pokemon.height ?? null,
        weightHg: pokemon.weight ?? null
    };
}

// Traduz descrição (e o gênero, quando também veio em inglês) numa chamada só.
// Devolve os campos a gravar; lança se a tradução falhar.
async function fillTranslation(row, { translateGenus = true } = {}) {
    if (!row.descriptionEn) return {};

    const texts = [row.descriptionEn];
    if (translateGenus && row.genus) texts.push(row.genus);

    const [description, genus] = await translateToPtBr(texts);
    const data = { description, descriptionSource: 'google-nmt' };
    if (genus) data.genus = genus;
    return data;
}

// Único ponto de entrada do jogo: banco primeiro, PokeAPI só no primeiro sorteio.
async function getPokemon(id, { errorLogger = null } = {}) {
    const existing = await prisma.pokemon.findUnique({ where: { id } });
    if (existing?.description || (existing && !existing.descriptionEn)) return existing;

    if (existing) {
        // Já espelhado, mas a tradução falhou da última vez: só ela é refeita. O gênero foi
        // gravado em inglês junto, então é traduzido de novo também.
        try {
            const data = await fillTranslation(existing);
            return await prisma.pokemon.update({ where: { id }, data });
        } catch (err) {
            errorLogger?.logError(err, { process: 'bot', context: 'pokemon.translate' });
            return existing;
        }
    }

    const fetched = await fetchFromPokeApi(id);
    const { genusIsPt, ...row } = fetched;

    if (!row.description) {
        try {
            Object.assign(row, await fillTranslation(row, { translateGenus: !genusIsPt }));
        } catch (err) {
            errorLogger?.logError(err, { process: 'bot', context: 'pokemon.translate' });
        }
    }

    return prisma.pokemon.upsert({ where: { id }, create: row, update: row });
}

async function fetchSprite(imageUrl) {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar sprite ${imageUrl}`);
    return Buffer.from(await res.arrayBuffer());
}

// "Mr. Mime", "mr mime" e "mr-mime" viram "mrmime"; "Farfetch'd" vira "farfetchd".
function normalizeName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function isCorrectGuess(guess, pokemon) {
    const normalized = normalizeName(guess);
    if (!normalized) return false;
    return normalized === normalizeName(pokemon.name) || normalized === normalizeName(pokemon.slug);
}

// Só as letras do nome, para a dica 2: "Mr. Mime" → "MRMIME", "Porygon-Z" → "PORYGONZ".
function nameLetters(name) {
    return Array.from(
        String(name || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
    )
        .filter((ch) => /\p{L}/u.test(ch))
        .join('')
        .toUpperCase();
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Apaga o nome do Pokémon da descrição, para a dica 3. Cobre o nome de exibição e o slug com
// espaços ou hífens; símbolos de gênero (Nidoran♀) caem fora para casar "Nidoran" sozinho.
function maskName(text, pokemon, mask = '?????') {
    const variants = new Set(
        [
            pokemon?.name,
            String(pokemon?.name || '').replace(/[♀♂]/g, '').trim(),
            String(pokemon?.slug || '').replace(/-/g, ' '),
            pokemon?.slug
        ]
            .map((v) => String(v || '').trim())
            .filter((v) => v.length >= 2)
    );

    let result = String(text || '');
    // Do mais longo para o mais curto, para "Mr. Mime" não virar "Mr. ?????".
    for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(variant)}(?![\\p{L}\\p{N}])`, 'giu');
        result = result.replace(pattern, mask);
    }
    return result;
}

function formatDecimal(value) {
    return value.toFixed(1).replace('.', ',');
}

// "Transform Pokémon · Normal · 1ª geração · 0,3 m · 4,0 kg" — usado na revelação do /pokemon e
// no fim do /forca pokemon.
function pokemonFactsLine(pokemon) {
    const facts = [];
    if (pokemon.genus) facts.push(pokemon.genus);
    facts.push(pokemon.types, `${pokemon.generation}ª geração`);
    if (pokemon.heightDm != null) facts.push(`${formatDecimal(pokemon.heightDm / 10)} m`);
    if (pokemon.weightHg != null) facts.push(`${formatDecimal(pokemon.weightHg / 10)} kg`);
    return facts.join(' · ');
}

// pt-BR quando a tradução já foi feita; senão o texto original em inglês.
function pokemonDescription(pokemon) {
    return pokemon.description || pokemon.descriptionEn || null;
}

function formatDexNumber(id) {
    return `#${String(id).padStart(3, '0')}`;
}

module.exports = {
    GENERATION_RANGES,
    MAX_POKEMON_ID,
    randomId,
    fetchFromPokeApi,
    fillTranslation,
    translateToPtBr,
    getPokemon,
    fetchSprite,
    normalizeName,
    isCorrectGuess,
    nameLetters,
    maskName,
    pokemonFactsLine,
    pokemonDescription,
    formatDexNumber
};
