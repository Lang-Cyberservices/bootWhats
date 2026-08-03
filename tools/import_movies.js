require('dotenv').config();
const { setTimeout: sleep } = require('node:timers/promises');
const { prisma } = require('../services/database');

const DELAY_BETWEEN_REQUESTS_MS = 200;

const MOVIE_NAMES = [
  'Taxi Driver',
  'Rocky: Um Lutador',
  'Todos os Homens do Presidente',
  'Rede de Intrigas',
  'Guerra nas Estrelas: Uma Nova Esperança',
  'Noivo Neurótico, Noiva Convulsa',
  'Contatos Imediatos do Terceiro Grau',
  'Os Embalos de Sábado à Noite',
  'Superman: O Filme',
  'O Sabotador',
  'O Franco Atirador',
  'Grease: Nos Tempos da Brilhantina',
  'Halloween: A Noite do Terror',
  'Apocalypse Now',
  'Alien: O Oitavo Passageiro',
  'Kramer vs. Kramer',
  'Mad Max',
  'Guerra nas Estrelas: O Império Contra-Ataca',
  'O Iluminado',
  'Touro Indomável',
  'Apertem os Cintos O Piloto Sumiu!',
  'Os Caçadores da Arca Perdida',
  'Fuga de Nova York',
  'Carruagens de Fogo',
  'Mad Max',
  'E.T. O Extraterrestre',
  'Blade Runner: O Caçador de Androides',
  'O Enigma de Outro Mundo',
  'Gandhi',
  'Guerra nas Estrelas: O Retorno de Jedi',
  'Scarface',
  'Os Eleitos',
  'A Resposta de um Estranho',
  'O Exterminador do Futuro',
  'Amadeus',
  'Os Caça-Fantasmas',
  'Era Uma Vez na América',
  'De Volta para o Futuro',
  'O Clube dos Cinco',
  'A Cor Púrpura',
  'Vá e Veja',
  'Platoon',
  'Aliens: O Resgate',
  'Top Gun: As Asas da Vitória',
  'Veludo Azul',
  'Nascido para Matar',
  'O Predador',
  'RoboCop: O Policial do Futuro',
  'Os Intocáveis',
  'Duro de Matar',
  'Meu Amigo Totoro',
  'Uma Cilada para Roger Rabbit',
  'Cinema Paradiso',
  'Batman',
  'Sociedade dos Poetas Mortos',
  'Faça a Coisa Certa',
  'Indiana Jones e a Última Cruzada',
  'Os Bons Companheiros',
  'O Poderoso Chefão',
  'Esqueceram de Mim',
  'Ghost: Do Outro Lado da Vida',
  'O Silêncio dos Inocentes',
  'O Exterminador do Futuro',
  'A Bela e a Fera',
  'Thelma & Louise',
  'Os Imperdoáveis',
  'Cães de Aluguel',
  'Aladdin',
  'Drácula de Bram Stoker',
  'Jurassic Park: O Parque dos Dinossauros',
  'A Lista de Schindler',
  'O Fugitivo',
  'O Estranho Mundo de Jack',
  'Pulp Fiction: Tempo de Violência',
  'Um Sonho de Liberdade',
  'O Rei Leão',
  'Forrest Gump: O Contador de Histórias',
  'Toy Story',
  'Seven: Os Sete Crimes Capitais',
  'Coração Valente',
  'Fogo Contra Fogo',
  'Fargo: Uma Comédia de Erros',
  'Trainspotting: Sem Limites',
  'Independence Day',
  'Pânico',
  'Titanic',
  'Gênio Indomável',
  'Princesa Mononoke',
  'Los Angeles: Cidade Proibida',
  'O Resgate do Soldado Ryan',
  'O Show de Truman',
  'O Grande Lebowski',
  'A Outra Face',
  'Matrix',
  'Clube da Luta',
  'O Sexto Sentido',
  'Magnólia',
  'Gladiador',
  'Amnésia',
  'O Tigre e o Dragão',
  'Amor à Flor da Pele',
  'O Senhor dos Anéis: A Sociedade do Anel',
  'A Viagem de Chihiro',
  'Cidade dos Sonhos',
  'O Fabuloso Destino de Amélie Poulain',
  'O Senhor dos Anéis: As Duas Torres',
  'Cidade de Deus',
  'O Pianista',
  'Homem-Aranha',
  'O Senhor dos Anéis: O Retorno do Rei',
  'Kill Bill: Volume',
  'Encontros e Desencontros',
  'Oldboy',
  'Brilho Eterno de uma Mente sem Lembranças',
  'Os Incríveis',
  'Antes do Pôr-do-Sol',
  'Menina de Ouro',
  'Batman Begins',
  'O Segredo de Brokeback Mountain',
  'Orgulho e Preconceito',
  'Sangue do Meu Sangue',
  'Os Infiltrados',
  'O Labirinto do Fauno',
  'Filhos da Esperança',
  'Pequena Miss Sunshine',
  'Onde os Fracos Não Têm Vez',
  'Sangue Negro',
  'Ratatouille',
  'Superbad: É Hoje',
  'Batman: O Cavaleiro das Trevas',
  'WALL-E',
  'Homem de Ferro',
  'Quem Quer Ser um Milionário?',
  'Avatar',
  'Bastardos Inglórios',
  'Up: Altas Aventuras',
  'O Segredo dos Seus Olhos',
  'A Origem',
  'A Rede Social',
  'Cisne Negro',
  'Toy Story',
  'A Invenção de Hugo Cabret',
  'Drive',
  'A Separação',
  'O Artista',
  'Os Vingadores',
  'Django Livre',
  'A Caça',
  'As Aventuras de Pi',
  'O Lobo de Wall Street',
  'Anos de Escravidão',
  'Ela',
  'Gravidade',
  'Interestelar',
  'Whiplash: Em Busca da Perfeição',
  'O Grande Hotel Budapeste',
  'Boyhood: Da Infância à Juventude',
  'Mad Max: Estrada da Fúria',
  'Divertida Mente',
  'O Regresso',
  'Spotlight: Segredos Revelados',
  'La La Land: Cantando Estações',
  'A Chegada',
  'Moonlight: Sob a Luz do Luar',
  'Manchester à Beira-Mar',
  'Corra!',
  'Blade Runner',
  'Dunkirk',
  'Viva: A Vida é uma Festa',
  'Homem-Aranha: No Aranhaverso',
  'Roma',
  'Pantera Negra',
  'Hereditário',
  'Parasita',
  'Coringa',
  'O Irlandês',
  'Era Uma Vez em... Hollywood',
  'Druk: Mais Uma Rodada',
  'Duna',
  'Soul',
  'Meu Pai',
  'A Escrevente / Ataque dos Cães',
  'Drive My Car',
  'Homem-Aranha: Sem Volta para Casa',
  'No Ritmo do Coração',
  'Tudo em Todo Lugar ao Mesmo Tempo',
  'Top Gun: Maverick',
  'O Batman',
  'Rrr: Revolt, Rebel, Revolt',
  'Oppenheimer',
  'Barbie',
  'Pobres Criaturas',
  'Assassinos da Lua das Flores',
  'Duna',
  'Divertida Mente',
  'Anora',
  'A Substância',
  'Avatar: Fogo e Cinzas',
  'Pequenas Coisas Como Estas',
  'Pequenas Guerreiras',
  'Tron: Ares',
  'Cinderela',
  'Mulan',
  'Romeu e Julieta',
  'procurando amy',
  'jab me wet',
  'don juan',
  'ela não está tão a fim de você',
  'caminhando nas nuvens',
  'Noite dos mortos vivos',
  'Moana',
  'Psicose',
  'Casablanca',
  'Cidadão Kane',
  'E o Vento Levou',
  'Cantando na Chuva',
  'Ben-Hur',
  'Lawrence da Arábia',
  'Janela Indiscreta',
  'Um Corpo que Cai',
  'Intriga Internacional',
  'Os Pássaros',
  'A Felicidade Não se Compra',
  'Doze Homens e uma Sentença',
  'A Ponte do Rio Kwai',
  'Laranja Mecânica',
  '2001: Uma Odisseia no Espaço',
  'Spartacus',
  'A Noviça Rebelde',
  'O Bebê de Rosemary',
  'Bonnie e Clyde',
  'Easy Rider',
  'Chinatown',
  'Operação França',
  'Tubarão',
  'Um Estranho no Ninho',
  'Os Caçadores da Arca Perdida',
  'Conan, o Bárbaro',
  'Os Goonies',
  'Conta Comigo',
  'Curtindo a Vida Adoidado',
  'A Princesa Prometida',
  'Labirinto',
  'Willow',
  'Akira',
  'Túmulo dos Vagalumes',
  'Nausicaä do Vale do Vento',
  'Kiki: Entregas a Domicílio',
  'Porco Rosso',
  'Sussurros do Coração',
  'Princesa Mononoke',
  'O Castelo Animado',
  'Ponyo',
  'Vidas em Jogo',
  'O Paciente Inglês',
  'O Quinto Elemento',
  'MIB: Homens de Preto',
  'Armageddon',
  'O Máskara',
  'O Corvo',
  'O Profissional',
  'O Quinto Elemento',
  'Donnie Darko',
  'Réquiem para um Sonho',
  'Quase Famosos',
  'Amnésia',
  'Donnie Brasco',
  'Um Dia de Cão',
  'O Terminal',
  'Prenda-me se For Capaz',
  'Minority Report',
  'A.I.: Inteligência Artificial',
  'Náufrago',
  'Beleza Americana',
  'American Pie',
  'Shrek',
  'Monstros S.A.',
  'Procurando Nemo',
  'Os Incríveis',
  'Carros',
  'Valente',
  'Frozen: Uma Aventura Congelante',
  'Zootopia',
  'Encanto',
  'Moana: Um Mar de Aventuras',
  'Lilo & Stitch',
  'Tarzan',
  'Hércules',
  'O Corcunda de Notre Dame',
  'Pocahontas',
  'A Pequena Sereia',
  'A Bela Adormecida',
  'Branca de Neve e os Sete Anões',
  'Pinóquio',
  'Fantasia',
  'Dumbo',
  'Bambi',
  'Alice no País das Maravilhas',
  'Peter Pan',
  'Robin Hood',
  'Bernardo e Bianca',
  'A Dama e o Vagabundo',
  'Aristogatas',
  'Bolt: Supercão',
  'Como Treinar o Seu Dragão',
  'Kung Fu Panda',
  'Madagascar',
  'A Fuga das Galinhas',
  'Coraline e o Mundo Secreto',
  'A Noiva Cadáver',
  'Frankenweenie',
  'O Estranho Mundo de Jack',
  'Wallace & Gromit: A Batalha dos Vegetais',
  'O Gigante de Ferro',
  'O Expresso Polar',
  'O Show de Truman',
  'O Curioso Caso de Benjamin Button',
  'Gran Torino',
  'Os Suspeitos',
  'Zodíaco',
  'Garota Exemplar',
  'A Ilha do Medo',
  'Os Oito Odiados',
  'Os Suspeitos',
  'Sicario: Terra de Ninguém',
  'A Qualquer Custo',
  'Blade Runner',
  'Logan',
  'Cisne Negro',
  'Birdman',
  'A Forma da Água',
  'Entre Facas e Segredos',
  'Jojo Rabbit',
  'Belfast',
  'Os Fabelmans',
  'Zona de Interesse',
  'O Menino e a Garça',
  'A Baleia',
  'Aftersun',
  'Vidas Passadas',
  'Nosferatu',
  'Nosferatu: O Vampiro da Noite',
  'O Farol',
  'A Bruxa',
  'Midsommar',
  'Fale Comigo',
  'Longlegs: Vínculo Mortal',
  'Pecadores',
  'Conclave'
];

async function fetchMovieId(name) {
  const apiKey = String(process.env.THEMOVIEDB_API || '').trim();
  const endpoint = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(apiKey)}&language=pt-BR&query=${encodeURIComponent(name)}`;

  try {
    const res = await fetch(endpoint, { method: 'GET' });
    if (!res.ok) {
      console.error(`Erro HTTP (${res.status}) ao buscar "${name}"`);
      return { id: null, error: 'http_error' };
    }
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return { id: results[0]?.id ?? null, error: null };
  } catch (err) {
    console.error(`Erro de rede ao buscar "${name}":`, err?.message || err);
    return { id: null, error: 'network_error' };
  }
}

async function main() {
  const apiKey = String(process.env.THEMOVIEDB_API || '').trim();
  if (!apiKey) {
    console.error('THEMOVIEDB_API não está definida no .env. Configure a chave antes de rodar o import.');
    process.exit(1);
  }

  const uniqueNames = Array.from(new Set(MOVIE_NAMES));

  const existingRows = await prisma.movie.findMany({ select: { id: true, name: true, themoviedbId: true } });
  const existingByName = new Map(existingRows.map((row) => [row.name, row]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const notFound = [];

  for (const name of uniqueNames) {
    const existing = existingByName.get(name);

    if (existing && existing.themoviedbId != null) {
      skipped++;
      continue;
    }

    const { id } = await fetchMovieId(name);
    if (id == null) notFound.push(name);

    if (existing) {
      await prisma.movie.update({ where: { id: existing.id }, data: { themoviedbId: id } });
      updated++;
    } else {
      await prisma.movie.create({ data: { name, themoviedbId: id } });
      created++;
    }

    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  console.log('\n=== Resumo ===');
  console.log(`Nomes únicos processados: ${uniqueNames.length}`);
  console.log(`Filmes criados: ${created}`);
  console.log(`Filmes atualizados: ${updated}`);
  console.log(`Filmes pulados (já tinham themoviedb_id): ${skipped}`);
  console.log(`Não encontrados na TMDB (${notFound.length}):`);
  for (const name of notFound) {
    console.log(`  - ${name}`);
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
