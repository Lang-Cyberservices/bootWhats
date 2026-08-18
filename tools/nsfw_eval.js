#!/usr/bin/env node
'use strict';

/**
 * Avaliador de precisão da moderação de imagens.
 *
 * Pontua uma pasta de imagens com o NSFWJS, grava tudo num CSV de ida e volta e
 * imprime métricas. É SOMENTE LEITURA: não apaga arquivo, não escreve no banco,
 * não fala com o WhatsApp. O único arquivo que ele escreve é o labels.csv dentro
 * da própria pasta avaliada.
 *
 * O LAION saiu daqui: a avaliação agora mede só o NSFWJS, com um limiar único.
 * Sem segunda opinião não existe zona cinzenta — a decisão é `nsfwScore >= limiar`.
 *
 * Números saem no padrão brasileiro (vírgula decimal), e por isso o CSV usa
 * ponto-e-vírgula como separador — é o que o Excel/LibreOffice pt-BR espera.
 * Na leitura o separador é detectado, então um labels.csv antigo (com vírgula)
 * continua sendo aproveitado.
 *
 *   node tools/nsfw_eval.js [pasta] [--models=inception_v3,mobilenet_v2_mid] [--limiar=0,95]
 */

require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const nsfw = require('nsfwjs');
const ImageAnalyzer = require('../services/ImageAnalyzer');

const CSV_NAME = 'labels.csv';
const CSV_SEPARATOR = ';';
const CLASSES = ['Neutral', 'Drawing', 'Sexy', 'Hentai', 'Porn'];

// Portão principal. `inception_v3` carrega os pesos de models/ — os mesmos que
// produção usa. `mobilenet_v2_mid` é o release v1.1.0 do nsfw_model (2020), uma
// arquitetura diferente e mais recente, que vem empacotada dentro do nsfwjs e
// não precisa de download.
const MODELS = {
    inception_v3: {
        label: 'inception_v3 (produção)',
        load: () => nsfw.load('file://./models/inception_v3/', { type: 'inception_v3', size: 299 }),
        fallbackInputSize: 299
    },
    mobilenet_v2_mid: {
        label: 'mobilenet_v2_mid (v1.1.0)',
        load: () => nsfw.load('MobileNetV2Mid', { type: 'graph' }),
        fallbackInputSize: 224
    }
};
const ALL_MODELS = Object.keys(MODELS);

// Modelo cuja decisão vai para a coluna do CSV, quando presente na rodada.
const PROD_MODEL = 'inception_v3';

// Limiar de bloqueio direto em produção hoje: a linha de base da comparação.
const DEFAULT_THRESHOLD = 0.95;

// ---------------------------------------------------------------- números BR

// Aceita "0,95" e "0.95": o limiar é digitado à mão e ninguém deveria ter que
// lembrar qual das duas o script quer.
function parseNumberBr(raw) {
    const value = Number(String(raw).trim().replace(',', '.'));
    return Number.isFinite(value) ? value : null;
}

function br(value, digits = 4) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return Number(value).toFixed(digits).replace('.', ',');
}

const pct = (v) => (v === null || v === undefined ? '  —  ' : `${br(v * 100, 1)}%`);

function parseList(arg, prefix, allowed, kind) {
    const values = arg
        .slice(prefix.length)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    const unknown = values.filter((v) => !allowed.includes(v));
    if (unknown.length) {
        throw new Error(`${kind} desconhecido: ${unknown.join(', ')}. Use: ${allowed.join(', ')}`);
    }
    return values;
}

function parseArgs(argv) {
    const positional = [];
    let models = ALL_MODELS;
    let threshold = DEFAULT_THRESHOLD;

    for (const arg of argv) {
        if (arg.startsWith('--models=')) {
            models = parseList(arg, '--models=', ALL_MODELS, 'Modelo');
        } else if (arg.startsWith('--limiar=')) {
            const parsed = parseNumberBr(arg.slice('--limiar='.length));
            if (parsed === null || parsed <= 0 || parsed > 1) {
                throw new Error(`Limiar inválido: ${arg}. Use um número entre 0 e 1 (ex.: --limiar=0,95)`);
            }
            threshold = parsed;
        } else if (arg.startsWith('--')) {
            throw new Error(`Opção desconhecida: ${arg}`);
        } else {
            positional.push(arg);
        }
    }

    if (!models.length) throw new Error('É preciso pelo menos um modelo em --models');

    return { dir: path.resolve(positional[0] || 'storage/eval'), models, threshold };
}

// ---------------------------------------------------------------- CSV

// O separador do arquivo lido vem do cabeçalho: escrevemos com ";" (padrão BR),
// mas um labels.csv gerado antes desta mudança usa "," e não pode ser perdido.
function detectSeparator(headerLine) {
    const semicolons = (headerLine.match(/;/g) || []).length;
    const commas = (headerLine.match(/,/g) || []).length;
    return semicolons >= commas ? ';' : ',';
}

function parseCsv(text) {
    const rows = [];
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { header: [], rows };

    const separator = detectSeparator(lines[0]);
    const header = splitCsvLine(lines[0], separator);
    for (const line of lines.slice(1)) {
        const cells = splitCsvLine(line, separator);
        const row = {};
        header.forEach((key, i) => {
            row[key] = cells[i] ?? '';
        });
        rows.push(row);
    }
    return { header, rows };
}

function splitCsvLine(line, separator = CSV_SEPARATOR) {
    const cells = [];
    let current = '';
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                quoted = false;
            } else {
                current += ch;
            }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === separator) {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells.map((c) => c.trim());
}

// Só o separador do arquivo (";") força aspas — a vírgula agora é decimal e
// aspas em todo número deixariam o CSV ilegível e sujeito a virar texto no Excel.
function toCsvCell(value) {
    const str = value === null || value === undefined ? '' : String(value);
    return /["\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Rótulos são digitados à mão e não podem ser perdidos por uma rodada
// interrompida: escreve em arquivo temporário e renomeia por cima.
async function writeCsvAtomic(filePath, header, rows) {
    const lines = [header.join(CSV_SEPARATOR)];
    for (const row of rows) {
        lines.push(header.map((key) => toCsvCell(row[key])).join(CSV_SEPARATOR));
    }
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    // BOM: sem ele o Excel abre o CSV como ANSI e estraga os acentos.
    await fs.writeFile(tmpPath, `﻿${lines.join('\n')}\n`, 'utf8');
    await fs.rename(tmpPath, filePath);
}

async function readExistingLabels(csvPath) {
    const labels = new Map();
    let text;
    try {
        text = await fs.readFile(csvPath, 'utf8');
    } catch (_) {
        return labels;
    }

    const { rows } = parseCsv(text.replace(/^﻿/, ''));
    for (const row of rows) {
        const label = normalizeLabel(row.label);
        if (row.file && label) labels.set(row.file, label);
    }
    return labels;
}

function normalizeLabel(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (['nsfw', 'n', '1', 'bloquear', 'impróprio', 'improprio'].includes(value)) return 'nsfw';
    if (['ok', 'o', '0', 'safe', 'limpo', 'liberar'].includes(value)) return 'ok';
    return '';
}

// ---------------------------------------------------------------- imagens

// Os arquivos de evidência são nomeados pelo md5 e a maioria não tem extensão,
// então o formato precisa sair do conteúdo, nunca do nome.
async function listImages(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const images = [];
    const skipped = [];

    for (const entry of entries) {
        if (!entry.isFile() || entry.name === CSV_NAME || entry.name.startsWith('.')) continue;

        const filePath = path.join(dir, entry.name);
        try {
            const metadata = await sharp(filePath).metadata();
            if (!metadata?.format) throw new Error('formato não identificado');
            images.push({
                name: entry.name,
                filePath,
                format: metadata.format,
                isAnimated: (metadata.pages || 1) > 1
            });
        } catch (err) {
            skipped.push({ name: entry.name, reason: err?.message || String(err) });
        }
    }

    images.sort((a, b) => a.name.localeCompare(b.name));
    return { images, skipped };
}

async function scoreWithNsfwjs(analyzer, images, fallbackInputSize) {
    const inputSize = analyzer.getModelInputSize(analyzer.model) || fallbackInputSize;
    const results = new Map();

    for (const image of images) {
        const buffer = await fs.readFile(image.filePath);
        const frames = await analyzer.extractFrameBuffers(buffer, {
            inputSize,
            isAnimated: image.isAnimated,
            mime: `image/${image.format}`,
            filePath: image.filePath
        });
        if (!frames.length) {
            results.set(image.name, null);
            continue;
        }
        const predictions = await analyzer.classifyFrames(frames);
        const byClass = {};
        for (const cls of CLASSES) {
            const found = predictions.find((p) => p.className === cls);
            byClass[cls] = found ? found.probability : 0;
        }
        results.set(image.name, byClass);
        process.stdout.write('.');
    }

    process.stdout.write('\n');
    return results;
}

// ---------------------------------------------------------------- decisão

// Sem o LAION não há zona cinzenta: um limiar único separa bloqueio de liberação.
function decide(nsfwScore, threshold) {
    return { blocked: nsfwScore >= threshold };
}

function nsfwScoreFrom(scores, { includeSexy }) {
    if (!scores) return 0;
    const parts = [scores.Porn, scores.Hentai];
    if (includeSexy) parts.push(scores.Sexy);
    return Math.max(...parts);
}

function confusion(rows, model, threshold, { includeSexy }) {
    const stats = { tp: 0, fp: 0, tn: 0, fn: 0, total: 0 };

    for (const row of rows) {
        const scores = row.models[model];
        if (!row.label || !scores) continue;
        stats.total++;
        const { blocked } = decide(nsfwScoreFrom(scores, { includeSexy }), threshold);
        const isNsfw = row.label === 'nsfw';

        if (blocked && isNsfw) stats.tp++;
        else if (blocked && !isNsfw) stats.fp++;
        else if (!blocked && isNsfw) stats.fn++;
        else stats.tn++;
    }

    const precision = stats.tp + stats.fp ? stats.tp / (stats.tp + stats.fp) : null;
    const recall = stats.tp + stats.fn ? stats.tp / (stats.tp + stats.fn) : null;
    const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : null;
    return { ...stats, precision, recall, f1, errors: stats.fp + stats.fn };
}

// Varredura fina: com um limiar só, o grid inteiro custa quase nada.
function sweep(rows, model, { includeSexy }) {
    let best = null;
    for (let raw = 0.05; raw <= 0.99 + 1e-9; raw += 0.01) {
        const threshold = Number(raw.toFixed(2));
        const stats = confusion(rows, model, threshold, { includeSexy });
        if (!stats.total) continue;
        if (!best || stats.errors < best.stats.errors ||
            (stats.errors === best.stats.errors && (stats.f1 ?? 0) > (best.stats.f1 ?? 0))) {
            best = { threshold, stats };
        }
    }
    return best;
}

// ---------------------------------------------------------------- relatório

function decisionModel(models) {
    return models.includes(PROD_MODEL) ? PROD_MODEL : models[0];
}

function printPerFile(rows, models, threshold) {
    const basis = decisionModel(models);
    console.log('\n═══ Pontuação por arquivo ═══');
    console.log(`(decisão simulada com ${basis}, limiar ${br(threshold, 2)})\n`);

    const table = rows.map((row) => {
        const entry = {
            arquivo: row.file.length > 24 ? `${row.file.slice(0, 21)}...` : row.file,
            rótulo: row.label || '—'
        };
        for (const model of models) {
            const s = row.models[model];
            entry[model] = s ? br(nsfwScoreFrom(s, { includeSexy: true }), 3) : '—';
        }

        const s = row.models[basis];
        if (s) {
            const d = decide(nsfwScoreFrom(s, { includeSexy: true }), threshold);
            entry.decisão = d.blocked ? 'BLOQUEIA' : 'libera';
        }
        return entry;
    });
    console.table(table);
}

function printMetrics(rows, models, threshold) {
    const labelled = rows.filter((r) => r.label && models.some((m) => r.models[m]));
    if (!labelled.length) {
        console.log('\n═══ Métricas ═══\n');
        console.log('  Nenhum arquivo rotulado ainda.');
        console.log(`  Preencha a coluna "label" do ${CSV_NAME} com "nsfw" ou "ok" e rode de novo`);
        console.log('  para ver matriz de confusão e varredura de limiares.\n');
        return;
    }

    const nsfwCount = labelled.filter((r) => r.label === 'nsfw').length;
    console.log(`\n═══ Métricas (${labelled.length} rotulados: ${nsfwCount} nsfw, ${labelled.length - nsfwCount} ok) ═══\n`);

    console.log(`Com o limiar atual (${br(threshold, 2)}):\n`);
    const current = [];
    for (const model of models) {
        const s = confusion(rows, model, threshold, { includeSexy: true });
        current.push({
            modelo: model,
            'falso+': s.fp,
            'falso-': s.fn,
            acertos: s.tp + s.tn,
            precisão: pct(s.precision),
            recall: pct(s.recall),
            F1: pct(s.f1)
        });
    }
    console.table(current);

    console.log('\nMelhor limiar encontrado para o seu conjunto:\n');
    const tuned = [];
    for (const model of models) {
        const best = sweep(rows, model, { includeSexy: true });
        if (!best) continue;
        tuned.push({
            modelo: model,
            limiar: br(best.threshold, 2),
            'falso+': best.stats.fp,
            'falso-': best.stats.fn,
            F1: pct(best.stats.f1)
        });
    }
    console.table(tuned);

    console.log('\nHipótese do "Sexy" — a classe entra no bloqueio automático com o mesmo peso de "Porn".');
    console.log('Se tirar ela reduzir falso positivo sem criar falso negativo, o problema não é o modelo:\n');
    const sexyTest = [];
    for (const model of models) {
        for (const includeSexy of [true, false]) {
            const s = confusion(rows, model, threshold, { includeSexy });
            sexyTest.push({
                modelo: model,
                Sexy: includeSexy ? 'inclui' : 'exclui',
                'falso+': s.fp,
                'falso-': s.fn,
                F1: pct(s.f1)
            });
        }
    }
    console.table(sexyTest);
}

// ---------------------------------------------------------------- main

async function main() {
    const { dir, models, threshold } = parseArgs(process.argv.slice(2));

    let stat;
    try {
        stat = await fs.stat(dir);
    } catch (_) {
        console.error(`❌ Pasta não encontrada: ${dir}`);
        console.error('   Crie a pasta e coloque as imagens de teste nela.');
        process.exit(1);
    }
    if (!stat.isDirectory()) {
        console.error(`❌ Não é uma pasta: ${dir}`);
        process.exit(1);
    }

    console.log(`📂 Avaliando ${dir}`);
    const { images, skipped } = await listImages(dir);

    if (skipped.length) {
        console.log(`\n⚠️ ${skipped.length} arquivo(s) ignorado(s) por não serem imagens legíveis:`);
        for (const s of skipped) console.log(`   ${s.name} — ${s.reason}`);
    }
    if (!images.length) {
        console.error('\n❌ Nenhuma imagem encontrada.');
        process.exit(1);
    }
    console.log(`🖼️ ${images.length} imagem(ns) encontrada(s).\n`);

    const csvPath = path.join(dir, CSV_NAME);
    const labels = await readExistingLabels(csvPath);
    if (labels.size) console.log(`🏷️ ${labels.size} rótulo(s) recuperado(s) do ${CSV_NAME}.\n`);

    const modelScores = {};
    for (const modelName of models) {
        console.log(`🔍 NSFWJS "${MODELS[modelName].label}"...`);
        const loaded = await MODELS[modelName].load();
        const analyzer = new ImageAnalyzer(loaded, { inputSize: MODELS[modelName].fallbackInputSize });
        modelScores[modelName] = await scoreWithNsfwjs(
            analyzer,
            images,
            MODELS[modelName].fallbackInputSize
        );
    }

    const rows = images.map((image) => ({
        file: image.name,
        label: labels.get(image.name) || '',
        models: Object.fromEntries(
            models.map((m) => [m, modelScores[m].get(image.name) || null])
        )
    }));

    const basis = decisionModel(models);
    const decisionCol = `decisao_${basis}`;

    const header = [
        'file', 'label',
        // Nome do modelo em cada coluna: sem isso não dá para saber de qual
        // modelo veio o score quando há mais de um na rodada.
        ...models.flatMap((m) => [
            `${m}_neutral`, `${m}_drawing`, `${m}_sexy`, `${m}_hentai`, `${m}_porn`,
            `${m}_nsfwScore`, `${m}_nsfwScoreNoSexy`
        ]),
        decisionCol
    ];

    const csvRows = rows.map((row) => {
        const out = { file: row.file, label: row.label };

        for (const modelName of models) {
            const s = row.models[modelName];
            out[`${modelName}_neutral`] = s ? br(s.Neutral, 6) : '';
            out[`${modelName}_drawing`] = s ? br(s.Drawing, 6) : '';
            out[`${modelName}_sexy`] = s ? br(s.Sexy, 6) : '';
            out[`${modelName}_hentai`] = s ? br(s.Hentai, 6) : '';
            out[`${modelName}_porn`] = s ? br(s.Porn, 6) : '';
            out[`${modelName}_nsfwScore`] = s ? br(nsfwScoreFrom(s, { includeSexy: true }), 6) : '';
            out[`${modelName}_nsfwScoreNoSexy`] = s ? br(nsfwScoreFrom(s, { includeSexy: false }), 6) : '';
        }

        const baseScores = row.models[basis];
        out[decisionCol] = baseScores
            ? (decide(nsfwScoreFrom(baseScores, { includeSexy: true }), threshold).blocked ? 'nsfw' : 'ok')
            : '';

        return out;
    });

    await writeCsvAtomic(csvPath, header, csvRows);

    printPerFile(rows, models, threshold);
    printMetrics(rows, models, threshold);

    console.log(`\n💾 CSV atualizado: ${csvPath} (separador "${CSV_SEPARATOR}", decimal com vírgula)`);
    if (!labels.size) {
        console.log('   Preencha a coluna "label" com "nsfw" ou "ok" e rode de novo para ver as métricas.');
        console.log('   Rótulos já preenchidos nunca são sobrescritos.');
    }
    console.log('   Nenhum arquivo foi apagado e nada foi gravado no banco.\n');
}

main().catch((err) => {
    console.error('\n❌ Erro:', err?.message || err);
    process.exit(1);
});
