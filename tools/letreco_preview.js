#!/usr/bin/env node
// Ferramenta de apoio ao /letreco: renderiza o tabuleiro sem subir o bot nem o
// banco, e confere as cores no terminal.
//
//   node tools/letreco_preview.js "CASA" "CAMA,SACO,AAAA" /tmp/letreco.png
//   node tools/letreco_preview.js "Costa Rica" "porta velha,brasilnovo" /tmp/letreco.png
//   node tools/letreco_preview.js --rules
const fs = require('node:fs/promises');
const { renderBoard } = require('../services/games/letrecoBoard');
const {
    normalizeText,
    extractLetters,
    wordLengths,
    scoreGuess
} = require('../services/games/letrecoWords');

const TILE_SYMBOL = { correct: '🟩', present: '🟨', absent: '🟥' };
const TILE_CHAR = { correct: 'C', present: 'P', absent: 'A' };

const PLAYERS = ['Ana', 'Bruno', 'Carlos', 'Daniela', 'Eduardo'];

function describe(letters, tiles) {
    return Array.from(letters)
        .map((letter, i) => `${TILE_SYMBOL[tiles[i]]}${letter}`)
        .join(' ');
}

async function renderPreview(answer, guessesText, output) {
    const targetLetters = extractLetters(answer);
    if (!targetLetters) throw new Error('A resposta não tem nenhuma letra utilizável.');

    const guesses = String(guessesText || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    const rows = [];
    let winnerLabel = null;

    for (const [index, guess] of guesses.entries()) {
        const letters = extractLetters(guess);
        if (letters.length !== targetLetters.length) {
            console.log(`⚠️  "${guess}" tem ${letters.length} letras; a resposta tem ${targetLetters.length}. Ignorado.`);
            continue;
        }

        const tiles = scoreGuess(targetLetters, letters);
        const label = PLAYERS[index % PLAYERS.length];
        rows.push({ letters, tiles, label });

        console.log(`${label.padEnd(8)} ${describe(letters, tiles)}   [${tiles.map((t) => TILE_CHAR[t]).join('')}]`);

        if (letters === targetLetters) {
            winnerLabel = label;
            break;
        }
    }

    const status = winnerLabel ? 'won' : (rows.length >= 10 ? 'lost' : 'active');

    const buffer = await renderBoard({
        category: wordLengths(answer).length > 1 ? 'pais' : 'dicionario',
        status,
        wordLengths: wordLengths(answer),
        rows,
        maxAttempts: 10,
        answer: status === 'active' ? null : answer,
        winnerLabel
    });

    await fs.writeFile(output, buffer);
    console.log('');
    console.log(`✅ ${output} (${buffer.length} bytes)`);
    console.log(`   Resposta: ${answer} → ${normalizeText(answer)} → ${targetLetters} (${targetLetters.length} letras)`);
    console.log(`   Estrutura: ${wordLengths(answer).join(' + ')}`);
    console.log(`   Status: ${status}`);
}

// Casos da especificação (§27) — servem de teste de regressão do pontuador.
function runRules() {
    const cases = [
        { target: 'CASA', guess: 'CAMA', expected: ['correct', 'correct', 'absent', 'correct'] },
        { target: 'CASA', guess: 'SACO', expected: ['present', 'correct', 'present', 'absent'] },
        { target: 'CASA', guess: 'AAAA', expected: ['absent', 'correct', 'absent', 'correct'] },
        { target: 'CASA', guess: 'CASA', expected: ['correct', 'correct', 'correct', 'correct'] },
        { target: 'ARARA', guess: 'RARAS', expected: ['present', 'present', 'present', 'present', 'absent'] }
    ];

    let failures = 0;

    for (const item of cases) {
        const actual = scoreGuess(item.target, item.guess);
        const ok = actual.join(',') === item.expected.join(',');
        if (!ok) failures += 1;
        console.log(`${ok ? '✅' : '❌'} ${item.target} × ${item.guess}: ${describe(item.guess, actual)}`);
        if (!ok) console.log(`   esperado: ${item.expected.join(', ')}`);
    }

    const normalizations = [
        { input: '  são   tomé ', expected: 'SAO TOME', fn: normalizeText },
        { input: 'São Tomé', expected: 'SAOTOME', fn: extractLetters },
        { input: 'Guiné-Bissau', expected: 'GUINE BISSAU', fn: normalizeText },
        { input: 'Cása 🙂', expected: 'CASA', fn: extractLetters }
    ];

    for (const item of normalizations) {
        const actual = item.fn(item.input);
        const ok = actual === item.expected;
        if (!ok) failures += 1;
        console.log(`${ok ? '✅' : '❌'} "${item.input}" → "${actual}"${ok ? '' : ` (esperado "${item.expected}")`}`);
    }

    const lengths = wordLengths('Costa Rica');
    const lengthsOk = lengths.join(',') === '5,4';
    if (!lengthsOk) failures += 1;
    console.log(`${lengthsOk ? '✅' : '❌'} wordLengths("Costa Rica") → [${lengths.join(', ')}]`);

    if (failures) {
        console.error(`\n❌ ${failures} verificação(ões) falharam.`);
        process.exitCode = 1;
        return;
    }
    console.log('\n✅ Todas as verificações passaram.');
}

async function main() {
    const [first, second, third] = process.argv.slice(2);

    if (!first || first === '--rules' || first === '--help') {
        if (first === '--rules') return runRules();
        console.log('Uso:');
        console.log('  node tools/letreco_preview.js "CASA" "CAMA,SACO,AAAA" [saida.png]');
        console.log('  node tools/letreco_preview.js --rules');
        return;
    }

    const output = third || '/tmp/letreco.png';
    await renderPreview(first, second || '', output);
}

main().catch((err) => {
    console.error(`❌ ${err?.message || err}`);
    process.exitCode = 1;
});
