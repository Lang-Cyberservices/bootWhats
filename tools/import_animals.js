require('dotenv').config();
const fs = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');
const cheerio = require('cheerio');

// Popula `animals` a partir das listas de fauna brasileira da Wikipédia.
//   node tools/import_animals.js [--dry-run] [--log=arquivo]
// Idempotente: rodar de novo não duplica nada, só completa descrição/imagem que faltaram.

const API_URL = 'https://pt.wikipedia.org/w/api.php';
const USER_AGENT = 'BootWhatsAnimalsImport/1.0 (bot de grupo; importador pontual)';
const DELAY_BETWEEN_REQUESTS_MS = 1000;
const MAX_RETRIES = 5;
const DETAILS_BATCH_SIZE = 20; // teto do exlimit da API para extracts
const INSERT_CHUNK_SIZE = 200;
const MAX_PER_LIST = 230;

// A ordem define quem é a "primeira ocorrência" de um nome popular repetido.
const SOURCES = [
  { key: 'mamiferos', page: 'Lista de mamíferos do Brasil' },
  { key: 'aves', page: 'Lista de aves do Brasil' },
  { key: 'anfibios', page: 'Lista de anfíbios do Brasil' },
  { key: 'peixes', page: 'Lista de peixes do Brasil' },
  { key: 'repteis', page: 'Lista de répteis do Brasil' }
];

const BINOMIAL_PATTERN = /^[A-Z][a-z]+(?: [a-z][a-z-]+){1,2}$/;
const NAME_PATTERN = /^\p{L}(?:[\p{L}'’ -]*\p{L})?$/u;
// Marcadores de status da lista de aves (vagante, endêmica, extinta...), em <b> depois do nome.
const STATUS_FLAG_PATTERN = /^[A-Z][A-Za-z]{0,2}$/;
const TRAILING_FLAGS_PATTERN = /(?:\s+(?:VA|VI|VN|VS|VO|V|E|ExN|Ex|In|D))+$/;
// Anotações que ocupam o lugar do nome popular sem ser um.
const ANNOTATION_PATTERN = /^(?:introduzid[ao]|extint[ao]|sensu|incertae)\b/;
const PLACEHOLDER_IMAGE_PATTERN = /\/Falta[_ ]imagem/i;

const skipped = [];

function logSkip(source, scientificName, reason) {
  skipped.push({ source, scientificName, reason });
}

function cleanText(text) {
  return String(text || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

async function apiGet(params) {
  const url = `${API_URL}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  let lastError;
  let retryAfterMs = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.ok) {
        const data = await res.json();
        if (data.error) throw new Error(`API: ${data.error.code} - ${data.error.info}`);
        return data;
      }
      lastError = new Error(`HTTP ${res.status}`);
      // A Wikipédia responde 429 com Retry-After quando o ritmo passa do limite.
      retryAfterMs = (Number(res.headers.get('retry-after')) || 0) * 1000;
      // 4xx que não seja rate limit não melhora com nova tentativa.
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_RETRIES) await sleep(Math.max(retryAfterMs, 2000 * 2 ** (attempt - 1)));
  }

  throw lastError;
}

// Extrai o primeiro nome popular do <li>, já sem nome científico, autor, ano e referências.
function extractCommonName($, li) {
  const clone = $(li).clone();
  clone.children('i').first().remove();
  // Figuras embutidas no item trazem a legenda (outro nome científico) para dentro do texto.
  clone.find('figure, sup, cite, small, i, span[style*="font-size"]').remove();
  clone.find('b').each((_, el) => {
    if (STATUS_FLAG_PATTERN.test(cleanText($(el).text()))) $(el).remove();
  });

  let text = cleanText(clone.text());
  // Autor/ano que ficou fora do elemento de autor: "(Thomas, 1917) - cutia".
  text = text.replace(/^.*\b\d{4}\w?\)?/, '');
  // Anotação antes do separador que não é nome: "(NR) - sagui-de-manicoré", "† - rato-de-noronha".
  const separated = text.match(/^(.*?)\s[-–—]\s+(.*)$/);
  if (separated && /[^\p{L}\s'’-]/u.test(separated[1])) text = separated[2];
  text = text.replace(/^[\s()\-–—:,.]+/, '');
  text = text.replace(TRAILING_FLAGS_PATTERN, '');

  const first = cleanText(text.split(/[,;/]| ou /)[0]).replace(/[.:]+$/, '');
  if (!first) return { name: null, raw: text };

  const name = first.normalize('NFC').toLowerCase();
  return { name: NAME_PATTERN.test(name) && !ANNOTATION_PATTERN.test(name) ? name : null, raw: text };
}

// Percorre a página na ordem do documento, carregando a família vigente para cada espécie.
function parseList(html, source) {
  const $ = cheerio.load(html);
  const entries = [];
  let order = null;
  let family = null;

  $('h2, h3, h4, p, li').each((_, el) => {
    const tag = el.tagName.toLowerCase();

    if (tag !== 'li') {
      const text = cleanText($(el).text());
      const familyMatch = text.match(/^Família\s+(\p{L}+)/u);
      if (familyMatch) {
        family = familyMatch[1];
      } else if (tag !== 'p' && !/^Subfamília/i.test(text)) {
        // Título de ordem/classe: as famílias anteriores não valem mais.
        order = text;
        family = null;
      }
      return;
    }

    const italic = $(el).children().first();
    if (!italic.is('i')) return;

    const scientificName = cleanText(italic.text());
    if (!BINOMIAL_PATTERN.test(scientificName)) {
      if (/^[A-Z][a-z]+ /.test(scientificName)) logSkip(source.key, scientificName, 'nome científico não é um binômio');
      return;
    }

    const link = italic.find('a').first();
    const hasPage = link.length > 0 && !link.hasClass('new') && Boolean(link.attr('title'));
    const { name, raw } = extractCommonName($, el);

    entries.push({
      source: source.key,
      scientificName,
      name,
      rawName: raw,
      pageTitle: hasPage ? link.attr('title') : null,
      group: family || order || 'sem grupo'
    });
  });

  return entries;
}

function isSimpleName(name) {
  return !/[ \-'’]/.test(name);
}

// Corta uma lista em MAX_PER_LIST cobrindo o maior número de famílias, com preferência por
// nomes simples ("saracuruçu" antes de "saracura-de-asa-vermelha") e por espécies com página.
function selectWithinLimit(entries) {
  if (entries.length <= MAX_PER_LIST) return entries;

  const rank = (entry) => (isSimpleName(entry.name) ? 0 : 2) + (entry.pageTitle ? 0 : 1);
  const groups = new Map();
  entries.forEach((entry, index) => {
    entry.listIndex = index;
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  });
  for (const list of groups.values()) list.sort((a, b) => rank(a) - rank(b) || a.listIndex - b.listIndex);

  const selected = [];
  const roundRobin = (accept) => {
    let took = true;
    while (took && selected.length < MAX_PER_LIST) {
      took = false;
      for (const list of groups.values()) {
        if (selected.length >= MAX_PER_LIST) break;
        if (list.length && accept(list[0])) {
          selected.push(list.shift());
          took = true;
        }
      }
    }
  };

  // Rodada 1: um representante de cada família, seja qual for o nome.
  for (const list of groups.values()) {
    if (selected.length >= MAX_PER_LIST) break;
    selected.push(list.shift());
  }
  roundRobin((entry) => isSimpleName(entry.name));
  roundRobin(() => true);

  const chosen = new Set(selected);
  for (const entry of entries) {
    if (!chosen.has(entry)) logSkip(entry.source, entry.scientificName, `fora do limite da lista (${entry.name})`);
  }
  return selected.sort((a, b) => a.listIndex - b.listIndex);
}

function firstParagraph(extract) {
  const paragraph = String(extract || '')
    .split('\n')
    .map((line) => cleanText(line.replace(/\[(?:\d+|nota \d+)\]/gi, '')))
    .find(Boolean);
  return paragraph || null;
}

function directImageUrl(source) {
  if (!source || PLACEHOLDER_IMAGE_PATTERN.test(source)) return null;
  return source.split('?')[0];
}

// Busca introdução e imagem principal de um lote de páginas, seguindo redirects.
async function fetchDetailsBatch(titles) {
  const pages = new Map();
  const aliases = new Map();
  const fragments = new Set();
  let cursor = {};

  for (;;) {
    const data = await apiGet({
      action: 'query',
      prop: 'extracts|pageimages|pageprops',
      exintro: '1',
      explaintext: '1',
      exlimit: String(DETAILS_BATCH_SIZE),
      piprop: 'original',
      pilimit: '50',
      ppprop: 'disambiguation',
      redirects: '1',
      titles: titles.join('|'),
      ...cursor
    });

    for (const item of data.query?.normalized || []) aliases.set(item.from, item.to);
    for (const item of data.query?.redirects || []) {
      aliases.set(item.from, item.to);
      // Redirect para uma seção de outra página: a introdução de lá não descreve esta espécie.
      if (item.tofragment) fragments.add(item.from);
    }
    for (const page of data.query?.pages || []) {
      const known = pages.get(page.title) || {};
      pages.set(page.title, {
        missing: Boolean(page.missing || page.invalid),
        disambiguation: known.disambiguation || Boolean(page.pageprops && 'disambiguation' in page.pageprops),
        extract: known.extract || page.extract,
        image: known.image || page.original?.source
      });
    }

    if (!data.continue) break;
    cursor = data.continue;
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  const result = new Map();
  for (const title of titles) {
    let resolved = title;
    let viaFragment = false;
    for (let hops = 0; hops < 5 && aliases.has(resolved); hops++) {
      if (fragments.has(resolved)) viaFragment = true;
      resolved = aliases.get(resolved);
    }
    const page = pages.get(resolved);
    if (!page || page.missing) result.set(title, { reason: 'página não encontrada' });
    else if (page.disambiguation) result.set(title, { reason: 'link leva a uma desambiguação' });
    else if (viaFragment) result.set(title, { reason: 'link redireciona para seção de outra página' });
    else result.set(title, { description: firstParagraph(page.extract), imgUrl: directImageUrl(page.image) });
  }
  return result;
}

async function fetchDetails(animals) {
  const titles = [...new Set(animals.map((animal) => animal.pageTitle).filter(Boolean))];
  const details = new Map();

  for (let i = 0; i < titles.length; i += DETAILS_BATCH_SIZE) {
    const batch = titles.slice(i, i + DETAILS_BATCH_SIZE);
    try {
      for (const [title, detail] of await fetchDetailsBatch(batch)) details.set(title, detail);
    } catch (err) {
      console.error(`Erro no lote ${i / DETAILS_BATCH_SIZE + 1}: ${err?.message || err}`);
      for (const title of batch) details.set(title, { reason: `falha ao buscar a página: ${err?.message || err}` });
    }
    process.stdout.write(`\rPáginas individuais: ${Math.min(i + DETAILS_BATCH_SIZE, titles.length)}/${titles.length}`);
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }
  if (titles.length) process.stdout.write('\n');

  for (const animal of animals) {
    const detail = animal.pageTitle ? details.get(animal.pageTitle) : { reason: 'espécie sem página própria' };
    animal.description = detail?.description || null;
    animal.imgUrl = detail?.imgUrl || null;
    if (detail?.reason) logSkip(animal.source, animal.scientificName, `sem descrição/imagem: ${detail.reason} (${animal.name})`);
  }
}

async function collect() {
  const seen = new Map();
  const animals = [];
  const summary = [];

  for (const source of SOURCES) {
    const stats = { lista: source.key, especies: 0, semNome: 0, duplicados: 0, candidatos: 0, selecionados: 0, familias: '', simples: 0 };
    summary.push(stats);

    let html;
    try {
      const data = await apiGet({ action: 'parse', page: source.page, prop: 'text', redirects: '1' });
      html = data.parse.text;
    } catch (err) {
      console.error(`Erro ao baixar "${source.page}": ${err?.message || err}`);
      logSkip(source.key, '-', `lista não pôde ser baixada: ${err?.message || err}`);
      continue;
    }
    await sleep(DELAY_BETWEEN_REQUESTS_MS);

    const candidates = [];
    for (const entry of parseList(html, source)) {
      stats.especies++;
      if (!entry.name) {
        stats.semNome++;
        logSkip(source.key, entry.scientificName, entry.rawName ? `nome popular inválido: "${entry.rawName}"` : 'sem nome popular');
        continue;
      }
      if (seen.has(entry.name)) {
        stats.duplicados++;
        logSkip(source.key, entry.scientificName, `"${entry.name}" duplicado de ${seen.get(entry.name)}`);
        continue;
      }
      seen.set(entry.name, entry.scientificName);
      candidates.push(entry);
    }

    const selected = selectWithinLimit(candidates);
    stats.candidatos = candidates.length;
    stats.selecionados = selected.length;
    stats.familias = `${new Set(selected.map((e) => e.group)).size}/${new Set(candidates.map((e) => e.group)).size}`;
    stats.simples = selected.filter((e) => isSimpleName(e.name)).length;
    animals.push(...selected);
  }

  return { animals, summary };
}

async function save(animals) {
  const { prisma } = require('../services/database');
  const result = { created: 0, completed: 0, unchanged: 0 };

  try {
    const existingRows = await prisma.animal.findMany({ select: { id: true, name: true, description: true, imgUrl: true } });
    const existingByName = new Map(existingRows.map((row) => [row.name, row]));

    const toCreate = [];
    for (const animal of animals) {
      const existing = existingByName.get(animal.name);
      if (!existing) {
        toCreate.push({ name: animal.name, scientificName: animal.scientificName, description: animal.description, imgUrl: animal.imgUrl });
        continue;
      }

      // Só preenche o que faltou numa execução anterior; a primeira ocorrência nunca é trocada.
      const data = {};
      if (existing.description == null && animal.description) data.description = animal.description;
      if (existing.imgUrl == null && animal.imgUrl) data.imgUrl = animal.imgUrl;
      if (Object.keys(data).length === 0) {
        result.unchanged++;
        continue;
      }
      await prisma.animal.update({ where: { id: existing.id }, data });
      result.completed++;
    }

    for (let i = 0; i < toCreate.length; i += INSERT_CHUNK_SIZE) {
      const { count } = await prisma.animal.createMany({ data: toCreate.slice(i, i + INSERT_CHUNK_SIZE), skipDuplicates: true });
      result.created += count;
    }
  } finally {
    await prisma.$disconnect();
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const logPath = args.find((arg) => arg.startsWith('--log='))?.slice('--log='.length);

  const { animals, summary } = await collect();
  console.table(summary);

  if (dryRun) {
    console.log(`--dry-run: ${animals.length} animais seriam importados (páginas individuais e banco não foram consultados).`);
  } else {
    await fetchDetails(animals);
    const result = await save(animals);
    console.log(`Coletados: ${animals.length}`);
    console.log(`Criados: ${result.created}`);
    console.log(`Completados (descrição/imagem): ${result.completed}`);
    console.log(`Já existentes sem alteração: ${result.unchanged}`);
    console.log(`Sem descrição: ${animals.filter((a) => !a.description).length} | sem imagem: ${animals.filter((a) => !a.imgUrl).length}`);
  }

  console.log(`Registros ignorados ou com ressalva: ${skipped.length}`);
  if (logPath) {
    fs.writeFileSync(logPath, skipped.map((s) => `${s.source}\t${s.scientificName}\t${s.reason}`).join('\n') + '\n');
    console.log(`Detalhes em ${logPath}`);
  } else {
    console.log('Use --log=arquivo para gravar o motivo de cada um.');
  }
}

main().catch((err) => {
  console.error('Falha no import de animais:', err);
  process.exit(1);
});
