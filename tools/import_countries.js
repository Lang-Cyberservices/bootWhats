require('dotenv').config();
const { setTimeout: sleep } = require('node:timers/promises');
const { prisma } = require('../services/database');

const DELAY_BETWEEN_REQUESTS_MS = 250;
const WIKI_USER_AGENT = 'BootWhats-ImportCountries/1.0 (contact: tiagosollero@gmail.com)';

const COUNTRY_NAMES = [
  'Albânia', 'Alemanha', 'Andorra', 'Angola', 'Antígua e Barbuda', 'Arábia Saudita',
  'Argélia', 'Argentina', 'Armênia', 'Austrália', 'Áustria', 'Azerbaijão', 'Bahamas',
  'Bangladesh', 'Barbados', 'Barein', 'Belarus', 'Bélgica', 'Belize', 'Benim', 'Bolívia',
  'Bósnia e Herzegovina', 'Botsuana', 'Brasil', 'Brunei', 'Bulgária', 'Burkina Fasso',
  'Burundi', 'Butão', 'Cabo Verde', 'Camarões', 'Camboja', 'Canadá', 'Catar',
  'Cazaquistão', 'Chade', 'Chile', 'China', 'Chipre', 'Colômbia', 'Comores', 'Congo',
  'Coreia do Norte', 'Coreia do Sul', 'Costa do Marfim', 'Costa Rica', 'Croácia', 'Cuba',
  'Dinamarca', 'Djibuti', 'Dominica', 'Egito', 'El Salvador', 'Emirados Árabes Unidos',
  'Equador', 'Eritreia', 'Eslováquia', 'Eslovênia', 'Espanha', 'Essuatíni',
  'Estados Unidos', 'Estônia', 'Etiópia', 'Fiji', 'Filipinas', 'Finlândia', 'França',
  'Gabão', 'Gâmbia', 'Gana', 'Geórgia', 'Granada', 'Grécia', 'Guatemala', 'Guiana',
  'Guiné', 'Guiné-Bissau', 'Guiné Equatorial', 'Haiti', 'Honduras', 'Hungria', 'Iêmen',
  'Ilhas Marshall', 'Ilhas Salomão', 'Índia', 'Indonésia', 'Irã', 'Iraque', 'Irlanda',
  'Islândia', 'Israel', 'Itália', 'Jamaica', 'Japão', 'Jordânia', 'Kiribati', 'Kosovo',
  'Kuwait', 'Laos', 'Lesoto', 'Letônia', 'Líbano', 'Libéria', 'Líbia', 'Liechtenstein',
  'Lituânia', 'Luxemburgo', 'Macedônia do Norte', 'Madagascar', 'Malásia', 'Malaui',
  'Maldivas', 'Mali', 'Malta', 'Marrocos', 'Maurício', 'Mauritânia', 'México', 'Mianmar',
  'Micronésia', 'Moçambique', 'Moldávia', 'Mônaco', 'Mongólia', 'Montenegro', 'Namíbia',
  'Nauru', 'Nepal', 'Nicarágua', 'Níger', 'Nigéria', 'Noruega', 'Nova Zelândia', 'Omã',
  'Países Baixos', 'Palau', 'Panamá', 'Papua-Nova Guiné', 'Paquistão', 'Paraguai', 'Peru',
  'Polônia', 'Portugal', 'Quênia', 'Quirguistão', 'Reino Unido',
  'República Centro-Africana', 'República Democrática do Congo', 'República Dominicana',
  'República Tcheca', 'Romênia', 'Ruanda', 'Rússia', 'Samoa', 'San Marino', 'Santa Lúcia',
  'São Cristóvão e Névis', 'São Tomé e Príncipe', 'São Vicente e Granadinas', 'Seicheles',
  'Senegal', 'Serra Leoa', 'Sérvia', 'Singapura', 'Síria', 'Somália', 'Sri Lanka',
  'Sudão', 'Sudão do Sul', 'Suécia', 'Suíça', 'Suriname', 'Tadjiquistão', 'Tailândia',
  'Taiwan', 'Tanzânia', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad e Tobago', 'Tunísia',
  'Turcomenistão', 'Turquia', 'Tuvalu', 'Ucrânia', 'Uganda', 'Uruguai', 'Uzbequistão',
  'Vanuatu', 'Vaticano', 'Venezuela', 'Vietnã', 'Zâmbia', 'Zimbábue'
];

// Nomes em português cuja busca direta na RestCountries falha ou é ambígua (validado manualmente).
const SEARCH_OVERRIDES = {
  Armênia: { search: 'Armenia', expectedCommon: 'Armenia' },
  Barein: { search: 'Bahrain', expectedCommon: 'Bahrain' },
  Benim: { search: 'Benin', expectedCommon: 'Benin' },
  Essuatíni: { search: 'Eswatini', expectedCommon: 'Eswatini' },
  'São Cristóvão e Névis': { search: 'Saint Kitts and Nevis', expectedCommon: 'Saint Kitts and Nevis' },
  'Reino Unido': { search: 'United Kingdom', expectedCommon: 'United Kingdom' },
  'Estados Unidos': { search: 'United States', expectedCommon: 'United States' },
  Congo: { search: 'Congo', expectedCommon: 'Congo' },
  'Países Baixos': { search: 'Netherlands', expectedCommon: 'Netherlands' },

  'Burkina Fasso': { search: 'Burkina Faso', expectedCommon: 'Burkina Faso' },
  Djibuti: { search: 'Djibouti', expectedCommon: 'Djibouti' },
  Eslovênia: { search: 'Slovenia', expectedCommon: 'Slovenia' },
  Estônia: { search: 'Estonia', expectedCommon: 'Estonia' },
  Letônia: { search: 'Latvia', expectedCommon: 'Latvia' },
  Malaui: { search: 'Malawi', expectedCommon: 'Malawi' },
  Mônaco: { search: 'Monaco', expectedCommon: 'Monaco' },
  'Papua-Nova Guiné': { search: 'Papua New Guinea', expectedCommon: 'Papua New Guinea' },
  Polônia: { search: 'Poland', expectedCommon: 'Poland' },
  Quênia: { search: 'Kenya', expectedCommon: 'Kenya' },
  'República Tcheca': { search: 'Czechia', expectedCommon: 'Czechia' },
  Tadjiquistão: { search: 'Tajikistan', expectedCommon: 'Tajikistan' },
  Vietnã: { search: 'Vietnam', expectedCommon: 'Vietnam' },
  Zimbábue: { search: 'Zimbabwe', expectedCommon: 'Zimbabwe' },

  China: { expectedCommon: 'China' },
  Chipre: { expectedCommon: 'Cyprus' },
  Dominica: { expectedCommon: 'Dominica' },
  França: { search: 'France', expectedCommon: 'France' },
  Gana: { search: 'Ghana', expectedCommon: 'Ghana' },
  Geórgia: { expectedCommon: 'Georgia' },
  Guiana: { search: 'Guyana', expectedCommon: 'Guyana' },
  Guiné: { search: 'Guinea', expectedCommon: 'Guinea' },
  Honduras: { expectedCommon: 'Honduras' },
  Irlanda: { expectedCommon: 'Ireland' },
  Israel: { expectedCommon: 'Israel' },
  Laos: { expectedCommon: 'Laos' },
  Mali: { expectedCommon: 'Mali' },
  Omã: { search: 'Oman', expectedCommon: 'Oman' },
  Rússia: { expectedCommon: 'Russia' },
  Samoa: { expectedCommon: 'Samoa' },
  Sudão: { expectedCommon: 'Sudan' },
  Tonga: { expectedCommon: 'Tonga' }
};

async function fetchCountryData(ptName) {
  const apiKey = String(process.env.RESTCOUNTRIES_API_KEY || '').trim();
  const override = SEARCH_OVERRIDES[ptName];
  const searchTerm = override?.search || ptName;
  const endpoint = `https://api.restcountries.com/countries/v5?q=${encodeURIComponent(searchTerm)}`;

  try {
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      return { status: 'http_error', detail: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const objects = Array.isArray(data?.data?.objects) ? data.data.objects : [];

    if (objects.length === 0) {
      return { status: 'not_found' };
    }

    let match = objects[0];
    if (objects.length > 1) {
      const expected = override?.expectedCommon;
      const found = expected ? objects.find((o) => o?.names?.common === expected) : null;
      if (!found) {
        return { status: 'ambiguous', candidates: objects.map((o) => o?.names?.common) };
      }
      match = found;
    }

    const sigla = match?.codes?.alpha_2 || null;
    if (!sigla) {
      return { status: 'missing_alpha2' };
    }

    return {
      status: 'ok',
      sigla,
      flag: match?.flag?.url_png || null,
      wikipediaUrl: match?.links?.wikipedia || null
    };
  } catch (err) {
    return { status: 'network_error', detail: err?.message || String(err) };
  }
}

async function fetchPortugueseSummary(wikipediaUrl) {
  if (!wikipediaUrl) return { text: null, language: null };

  try {
    const url = new URL(wikipediaUrl);
    const title = decodeURIComponent(url.pathname.split('/wiki/')[1] || '');
    if (!title) return { text: null, language: null };

    const langlinksEndpoint = `https://${url.host}/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=langlinks&lllang=pt&format=json`;
    const langRes = await fetch(langlinksEndpoint, { headers: { 'User-Agent': WIKI_USER_AGENT } });

    let ptTitle = null;
    if (langRes.ok) {
      const langData = await langRes.json();
      const page = Object.values(langData?.query?.pages || {})[0];
      ptTitle = page?.langlinks?.[0]?.['*'] || null;
    }

    if (ptTitle) {
      const summaryRes = await fetch(
        `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(ptTitle)}`,
        { headers: { 'User-Agent': WIKI_USER_AGENT } }
      );
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        if (summaryData?.extract) {
          return { text: summaryData.extract, language: 'pt' };
        }
      }
    }

    const fallbackRes = await fetch(
      `https://${url.host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { 'User-Agent': WIKI_USER_AGENT } }
    );
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      if (fallbackData?.extract) {
        return { text: fallbackData.extract, language: 'en' };
      }
    }

    return { text: null, language: null };
  } catch (err) {
    console.error('Erro ao buscar resumo da Wikipedia:', err?.message || err);
    return { text: null, language: null };
  }
}

async function main() {
  const apiKey = String(process.env.RESTCOUNTRIES_API_KEY || '').trim();
  if (!apiKey) {
    console.error('RESTCOUNTRIES_API_KEY não está definida no .env. Configure o token antes de rodar o import.');
    process.exit(1);
  }

  const uniqueNames = Array.from(new Set(COUNTRY_NAMES));

  const existingRows = await prisma.country.findMany({ select: { name: true } });
  const existingNames = new Set(existingRows.map((row) => row.name));

  let created = 0;
  let skipped = 0;
  const notFound = [];
  const ambiguous = [];
  const errors = [];
  const englishFallback = [];
  const noDescription = [];

  for (const name of uniqueNames) {
    if (existingNames.has(name)) {
      skipped++;
      continue;
    }

    const country = await fetchCountryData(name);

    if (country.status === 'not_found') {
      notFound.push(name);
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
      continue;
    }
    if (country.status === 'ambiguous') {
      ambiguous.push(`${name} (candidatos: ${country.candidates.join(', ')})`);
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
      continue;
    }
    if (country.status !== 'ok') {
      errors.push(`${name}: ${country.status} ${country.detail || ''}`.trim());
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
      continue;
    }

    const { text: description, language } = await fetchPortugueseSummary(country.wikipediaUrl);
    if (language === 'en') englishFallback.push(name);
    if (!description) noDescription.push(name);

    await prisma.country.create({
      data: { name, sigla: country.sigla, flag: country.flag, description }
    });
    created++;

    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  console.log('\n=== Resumo ===');
  console.log(`Países na lista: ${uniqueNames.length}`);
  console.log(`Criados: ${created}`);
  console.log(`Pulados (já existiam): ${skipped}`);
  console.log(`Não encontrados (${notFound.length}):`);
  for (const name of notFound) console.log(`  - ${name}`);
  console.log(`Ambíguos (${ambiguous.length}):`);
  for (const name of ambiguous) console.log(`  - ${name}`);
  if (errors.length) {
    console.log(`Erros (${errors.length}):`);
    for (const err of errors) console.log(`  - ${err}`);
  }
  console.log(`Descrição em inglês, sem versão em pt (${englishFallback.length}):`);
  for (const name of englishFallback) console.log(`  - ${name}`);
  console.log(`Sem descrição alguma (${noDescription.length}):`);
  for (const name of noDescription) console.log(`  - ${name}`);
}

main()
  .catch((err) => {
    console.error('Erro no import:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
