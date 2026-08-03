require('dotenv').config();
const fs = require('node:fs');
const readline = require('node:readline');
const { prisma } = require('../services/database');

const POS_FIELD_MAP = {
  noun: 'nounMeaning',
  verb: 'verbMeaning',
  adj: 'adjectiveMeaning',
  adv: 'adverbMeaning'
};

const PROGRESS_EVERY = 200000;
// O adapter @prisma/adapter-mariadb usa um pool com limite padrão de 10 conexões;
// ficar abaixo disso evita "pool timeout" em imports longos.
const WRITE_CONCURRENCY = 8;

function extractMeaning(entry) {
  const senseTexts = (entry.senses || [])
    .map((sense) => (sense.glosses || []).join('; '))
    .filter(Boolean);
  return senseTexts.join('; ');
}

async function readAndAggregate(filePath) {
  const aggregated = new Map();
  const ignoredPos = new Map();
  let totalLines = 0;
  let parseErrors = 0;
  let ptLines = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalLines++;

    if (totalLines % PROGRESS_EVERY === 0) {
      console.log(`... ${totalLines} linhas lidas (${ptLines} em pt, ${aggregated.size} palavras)`);
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch (_) {
      parseErrors++;
      continue;
    }

    if (entry.lang_code !== 'pt') continue;
    ptLines++;

    const field = POS_FIELD_MAP[entry.pos];
    if (!field) {
      ignoredPos.set(entry.pos, (ignoredPos.get(entry.pos) || 0) + 1);
      continue;
    }

    const meaning = extractMeaning(entry);
    if (!meaning) continue;

    if (!aggregated.has(entry.word)) {
      aggregated.set(entry.word, {
        nounMeaning: [],
        verbMeaning: [],
        adjectiveMeaning: [],
        adverbMeaning: []
      });
    }
    aggregated.get(entry.word)[field].push(meaning);
  }

  return { aggregated, ignoredPos, totalLines, parseErrors, ptLines };
}

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = index++;
      await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

async function persist(aggregated) {
  const existingRows = await prisma.dictionary.findMany({ select: { id: true, word: true } });
  const existingByWord = new Map(existingRows.map((row) => [row.word, row.id]));

  let created = 0;
  let updated = 0;

  await runWithConcurrency(Array.from(aggregated.entries()), WRITE_CONCURRENCY, async ([word, meanings]) => {
    const data = {};
    if (meanings.nounMeaning.length) data.nounMeaning = meanings.nounMeaning.join('; ');
    if (meanings.verbMeaning.length) data.verbMeaning = meanings.verbMeaning.join('; ');
    if (meanings.adjectiveMeaning.length) data.adjectiveMeaning = meanings.adjectiveMeaning.join('; ');
    if (meanings.adverbMeaning.length) data.adverbMeaning = meanings.adverbMeaning.join('; ');

    const existingId = existingByWord.get(word);
    if (existingId) {
      await prisma.dictionary.update({ where: { id: existingId }, data });
      updated++;
    } else {
      await prisma.dictionary.create({
        data: { word, charactersCount: Array.from(word).length, ...data }
      });
      created++;
    }
  });

  return { created, updated };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: node tools/import_dictionary.js /caminho/do/arquivo.jsonl');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    process.exit(1);
  }

  console.log('Lendo e agregando o arquivo...');
  const { aggregated, ignoredPos, totalLines, parseErrors, ptLines } = await readAndAggregate(filePath);

  console.log(`Gravando ${aggregated.size} palavras no banco...`);
  const { created, updated } = await persist(aggregated);

  console.log('\n=== Resumo ===');
  console.log(`Linhas lidas: ${totalLines}`);
  console.log(`Linhas com erro de parse: ${parseErrors}`);
  console.log(`Linhas em pt processadas: ${ptLines}`);
  console.log(`Palavras criadas: ${created}`);
  console.log(`Palavras atualizadas: ${updated}`);

  const sortedIgnored = Array.from(ignoredPos.entries()).sort((a, b) => b[1] - a[1]);
  console.log(`\nPOS ignorados (${sortedIgnored.length} tipos distintos):`);
  for (const [pos, count] of sortedIgnored) {
    console.log(`  ${pos}: ${count}`);
  }
}

main()
  .catch((err) => {
    console.error('Erro no import:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
