// Registro central dos comandos do bot: e a unica fonte da lista de comandos
// conhecidos e do mapa alias -> nome canonico usado por /fechar e /abrir.
// O nome canonico (campo `name`) e o que vai para a tabela commands_blocked,
// entao fechar `pergunta` cobre /pergunta, /bola8 e /8ball de uma vez.
//
// `aliases` sao as formas realmente despachadas por CommandHandler.handle().
// `extraNames` sao apelidos aceitos apenas por /fechar e /abrir, para o caso de
// comandos cujo nome canonico nao e digitavel (o dado responde a /d e a
// notacoes como /2d6+3, mas "/dado" nao inicia comando nenhum).
const COMMAND_DEFINITIONS = [
    { name: 'ban', aliases: ['/ban'] },
    { name: 'adm', aliases: ['/adm'] },
    { name: 'oraculo', aliases: ['/oraculo', '/oráculo'] },
    { name: 'sobre', aliases: ['/sobre'] },
    { name: 'ajuda', aliases: ['/ajuda', '/help'] },
    { name: 'sticker', aliases: ['/sticker'] },
    { name: 'piada', aliases: ['/piada'] },
    { name: 'proibir', aliases: ['/proibir'] },
    { name: 'rank', aliases: ['/rank'] },
    { name: 'noticias', aliases: ['/noticias', '/news'] },
    { name: 'cotacao', aliases: ['/cotacao'] },
    { name: 'check', aliases: ['/check'] },
    { name: 'books', aliases: ['/books', '/livros'] },
    { name: 'pergunta', aliases: ['/pergunta', '/bola8', '/8ball'] },
    { name: 'horoscopo', aliases: ['/horoscopo', '/horóscopo', '/signo'] },
    { name: 'sorteio', aliases: ['/sorteio'] },
    { name: 'dado', aliases: ['/d'], extraNames: ['dados'] },
    { name: 'definir', aliases: ['/definir'] },
    { name: 'filme', aliases: ['/filme'] },
    { name: 'forca', aliases: ['/forca'] },
    { name: 'pais', aliases: ['/pais'] },
    { name: 'fechar', aliases: ['/fechar'], protected: true },
    { name: 'abrir', aliases: ['/abrir'], protected: true }
];

function normalizeCommandText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

// Aceita "forca", "/forca", "8ball" ou "ORÁCULO" e devolve sempre a mesma chave.
function normalizeAlias(value) {
    return normalizeCommandText(value).replace(/^\/+/, '');
}

const KNOWN_COMMANDS = COMMAND_DEFINITIONS.flatMap((definition) => definition.aliases);

const DEFINITION_BY_ALIAS = new Map();
const DEFINITION_BY_NAME = new Map();
for (const definition of COMMAND_DEFINITIONS) {
    DEFINITION_BY_NAME.set(definition.name, definition);
    DEFINITION_BY_ALIAS.set(normalizeAlias(definition.name), definition);
    for (const alias of [...definition.aliases, ...(definition.extraNames || [])]) {
        DEFINITION_BY_ALIAS.set(normalizeAlias(alias), definition);
    }
}

// Devolve a definicao do comando a partir de qualquer alias, ou null.
function resolveCommandName(input) {
    const key = normalizeAlias(input);
    if (!key) return null;
    return DEFINITION_BY_ALIAS.get(key) || null;
}

function getDefinition(name) {
    return DEFINITION_BY_NAME.get(String(name || '')) || null;
}

module.exports = {
    COMMAND_DEFINITIONS,
    KNOWN_COMMANDS,
    resolveCommandName,
    getDefinition,
    normalizeCommandText
};
