#!/usr/bin/env node
// Ferramenta de apoio ao /pokemon: renderiza a silhueta e a revelação sem subir o bot, e mostra as
// dicas e a legenda final como sairiam no grupo.
//
//   node tools/pokemon_preview.js 132 /tmp/poke.png        # grava /tmp/poke.png e /tmp/poke_reveal.png
//   node tools/pokemon_preview.js 132 /tmp/poke.png --no-db # direto da PokeAPI, sem tocar o espelho
//   node tools/pokemon_preview.js --rules                   # normalizador e maskName, sem rede nem banco
//
// Sem --no-db usa o mesmo getPokemon do jogo, então também preenche a tabela `pokemons`.
require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const PokemonGame = require('../services/games/pokemon');
const { renderSilhouette, renderReveal } = require('../services/games/pokemonImage');
const {
    getPokemon,
    fetchFromPokeApi,
    fillTranslation,
    fetchSprite,
    isCorrectGuess,
    nameLetters,
    maskName
} = require('../services/games/pokemonData');

function runRules() {
    const cases = [
        { pokemon: { name: 'Mr. Mime', slug: 'mr-mime' }, guesses: ['mr mime', 'Mr. Mime', 'MR-MIME', 'mrmime'], wrong: ['mime', 'mr'] },
        { pokemon: { name: "Farfetch'd", slug: 'farfetchd' }, guesses: ['farfetchd', "farfetch'd", 'Farfetch d'], wrong: ['farfetch'] },
        { pokemon: { name: 'Nidoran♀', slug: 'nidoran-f' }, guesses: ['nidoran', 'Nidoran♀', 'nidoran f'], wrong: ['nidorina'] },
        { pokemon: { name: 'Porygon-Z', slug: 'porygon-z' }, guesses: ['porygon z', 'porygonz', 'Porygon-Z'], wrong: ['porygon', 'porygon2'] },
        { pokemon: { name: 'Flabébé', slug: 'flabebe' }, guesses: ['flabebe', 'Flabébé'], wrong: ['flabe'] }
    ];

    for (const { pokemon, guesses, wrong } of cases) {
        for (const guess of guesses) assert.ok(isCorrectGuess(guess, pokemon), `"${guess}" deveria acertar ${pokemon.name}`);
        for (const guess of wrong) assert.ok(!isCorrectGuess(guess, pokemon), `"${guess}" não deveria acertar ${pokemon.name}`);
        console.log(`✔ ${pokemon.name.padEnd(12)} letras: ${nameLetters(pokemon.name)}`);
    }

    const masks = [
        [{ name: 'Ditto', slug: 'ditto' }, 'Quando encontra outro Ditto, o DITTO se move mais rápido.', 'Quando encontra outro ?????, o ????? se move mais rápido.'],
        [{ name: 'Mr. Mime', slug: 'mr-mime' }, 'Mr. Mime cria paredes invisíveis. Um mr mime é mímico.', '????? cria paredes invisíveis. Um ????? é mímico.'],
        [{ name: 'Nidoran♀', slug: 'nidoran-f' }, 'Nidoran tem farpas venenosas.', '????? tem farpas venenosas.'],
        [{ name: 'Porygon-Z', slug: 'porygon-z' }, 'Um Porygon-Z foi reprogramado. Porygon é a forma anterior.', 'Um ????? foi reprogramado. Porygon é a forma anterior.'],
        [{ name: 'Mew', slug: 'mew' }, 'Mewtwo foi clonado de Mew.', 'Mewtwo foi clonado de ?????.']
    ];
    for (const [pokemon, text, expected] of masks) {
        assert.equal(maskName(text, pokemon), expected);
        console.log(`✔ maskName ${pokemon.name}`);
    }

    console.log('\nTodas as regras conferem.');
}

// Sem banco: mesma montagem do getPokemon, tentando a tradução mas sem gravar nada.
async function loadWithoutDb(id) {
    const { genusIsPt, ...row } = await fetchFromPokeApi(id);
    if (!row.description) {
        try {
            Object.assign(row, await fillTranslation(row, { translateGenus: !genusIsPt }));
        } catch (err) {
            console.warn(`⚠ Tradução falhou, usando inglês: ${err.message.slice(0, 160)}`);
        }
    }
    return row;
}

async function renderPreview(id, output, { noDb }) {
    const started = Date.now();
    const pokemon = noDb
        ? await loadWithoutDb(id)
        : await getPokemon(id, { errorLogger: { logError: (err) => console.warn(`⚠ Tradução falhou: ${err.message.slice(0, 160)}`) } });
    console.log(`#${pokemon.id} ${pokemon.name} carregado em ${Date.now() - started} ms (${noDb ? 'PokeAPI, sem banco' : 'via espelho'})`);
    console.log(`descrição: ${pokemon.descriptionSource || 'sem pt-BR (fallback em inglês)'}\n`);

    const sprite = await fetchSprite(pokemon.imageUrl);
    const revealPath = output.replace(/(\.png)?$/i, '_reveal.png');
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, await renderSilhouette(sprite));
    await fs.writeFile(revealPath, await renderReveal(sprite));

    const game = new PokemonGame();
    const state = { pokemon, hintLevel: 3, wrongGuesses: [{ label: 'Ana', guess: 'gengar' }, { label: 'Bruno', guess: 'muk' }] };
    console.log('--- legenda com as 3 dicas ---');
    console.log(game.buildRoundText(state));
    console.log('\n--- legenda final ---');
    console.log(game.buildRevealText(state, '🎉 *Parabéns @Ana!* (+4 pontos)'));
    console.log(`\nSilhueta: ${output}\nRevelação: ${revealPath}`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--rules')) {
        runRules();
        return;
    }

    const noDb = args.includes('--no-db');
    const [idArg, output = '/tmp/pokemon.png'] = args.filter((a) => !a.startsWith('--'));
    const id = Number(idArg);
    if (!Number.isInteger(id) || id < 1) {
        console.error('Uso: node tools/pokemon_preview.js <id> [saida.png] [--no-db] | --rules');
        process.exit(1);
    }

    await renderPreview(id, output, { noDb });
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err?.stack || err);
        process.exit(1);
    });
