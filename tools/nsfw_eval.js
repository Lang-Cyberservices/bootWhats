#!/usr/bin/env node
'use strict';

/**
 * Avaliador de precisão da moderação de imagens.
 *
 * Pontua uma pasta de imagens com o NSFWJS e com cada variante do LAION, grava
 * tudo num CSV de ida e volta e imprime métricas. É SOMENTE LEITURA: não apaga
 * arquivo, não escreve no banco, não fala com o WhatsApp. O único arquivo que
 * ele escreve é o labels.csv dentro da própria pasta avaliada.
 *
 *   node tools/nsfw_eval.js [pasta] [--variants=b32-legacy,b32,l14]
 */

require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const nsfw = require('nsfwjs');
const ImageAnalyzer = require('../services/ImageAnalyzer');
const LaionClient = require('../services/analyzer/LaionClient');

const CSV_NAME = 'labels.csv';
const ALL_VARIANTS = ['b32-legacy', 'b32', 'l14'];
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

// Configuração de produção: é a combinação que a coluna de decisão simula.
const PROD_MODEL = 'inception_v3';
const PROD_VARIANT = 'b32-legacy';

// Limiares em produção hoje, usados como linha de base na comparação.
const CURRENT = {
    hard: 0.95,
    soft: 0.65,
    laion: Number(process.env.LAION_THRESHOLD ?? 0.5)
};

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
    let variants = ALL_VARIANTS;
    let models = ALL_MODELS;

    for (const arg of argv) {
        if (arg.startsWith('--variants=')) {
            variants = parseList(arg, '--variants=', ALL_VARIANTS, 'Variante');
        } else if (arg.startsWith('--models=')) {
            models = parseList(arg, '--models=', ALL_MODELS, 'Modelo');
        } else if (arg === '--no-laion') {
            variants = [];
        } else if (arg.startsWith('--')) {
            throw new Error(`Opção desconhecida: ${arg}`);
        } else {
            positional.push(arg);
        }
    }

    if (!models.length) throw new Error('É preciso pelo menos um modelo em --models');

    return { dir: path.resolve(positional[0] || 'storage/eval'), variants, models };
}

// ---------------------------------------------------------------- CSV

function parseCsv(text) {
    const rows = [];
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { header: [], rows };

    const header = splitCsvLine(lines[0]);
    for (const line of lines.slice(1)) {
        const cells = splitCsvLine(line);
        const row = {};
        header.forEach((key, i) => {
            row[key] = cells[i] ?? '';
        });
        rows.push(row);
    }
    return { header, rows };
}

function splitCsvLine(line) {
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
        } else if (ch === ',') {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells.map((c) => c.trim());
}

function toCsvCell(value) {
    const str = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Rótulos são digitados à mão e não podem ser perdidos por uma rodada
// interrompida: escreve em arquivo temporário e renomeia por cima.
async function writeCsvAtomic(filePath, header, rows) {
    const lines = [header.join(',')];
    for (const row of rows) {
        lines.push(header.map((key) => toCsvCell(row[key])).join(','));
    }
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    await fs.writeFile(tmpPath, `${lines.join('\n')}\n`, 'utf8');
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

    const { rows } = parseCsv(text);
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

// Um cliente por variante, pontuando TODAS as imagens antes de trocar: carregar
// o CLIP custa ~90s, então o laço externo precisa ser a variante. Invertido,
// uma pasta de 50 arquivos levaria horas.
async function scoreWithLaion(variant, images) {
    const client = new LaionClient({ variant });
    const results = new Map();

    try {
        for (const image of images) {
            try {
                results.set(image.name, await client.score(image.filePath));
            } catch (err) {
                results.set(image.name, null);
                console.warn(`\n  ⚠️ ${image.name}: ${err?.message || err}`);
            }
            process.stdout.write('.');
        }
    } finally {
        client.stop();
    }

    process.stdout.write('\n');
    return results;
}

// ---------------------------------------------------------------- decisão

// Reproduz a lógica de ImageAnalyzer.analyze: acima do hard bloqueia direto,
// abaixo do soft libera direto, e só no meio o LAION opina. É por isso que a
// maioria das decisões nunca chega ao LAION.
function decide(nsfwScore, laionScore, thresholds) {
    if (nsfwScore >= thresholds.hard) return { blocked: true, gate: 'HARD_BLOCK' };
    if (nsfwScore < thresholds.soft) return { blocked: false, gate: 'PASS' };
    if (laionScore === null || laionScore === undefined) return { blocked: null, gate: 'LAION_INDEF' };
    return { blocked: laionScore >= thresholds.laion, gate: 'LAION' };
}

function nsfwScoreFrom(scores, { includeSexy }) {
    if (!scores) return 0;
    const parts = [scores.Porn, scores.Hentai];
    if (includeSexy) parts.push(scores.Sexy);
    return Math.max(...parts);
}

function confusion(rows, model, variant, thresholds, { includeSexy }) {
    const stats = { tp: 0, fp: 0, tn: 0, fn: 0, undecided: 0, total: 0 };

    for (const row of rows) {
        const scores = row.models[model];
        if (!row.label || !scores) continue;
        stats.total++;
        const nsfwScore = nsfwScoreFrom(scores, { includeSexy });
        const { blocked } = decide(nsfwScore, row.laion[variant], thresholds);
        const isNsfw = row.label === 'nsfw';

        if (blocked === null) stats.undecided++;
        else if (blocked && isNsfw) stats.tp++;
        else if (blocked && !isNsfw) stats.fp++;
        else if (!blocked && isNsfw) stats.fn++;
        else stats.tn++;
    }

    const precision = stats.tp + stats.fp ? stats.tp / (stats.tp + stats.fp) : null;
    const recall = stats.tp + stats.fn ? stats.tp / (stats.tp + stats.fn) : null;
    const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : null;
    return { ...stats, precision, recall, f1, errors: stats.fp + stats.fn };
}

function sweep(rows, model, variant, { includeSexy }) {
    const grid = (from, to, step) => {
        const values = [];
        for (let v = from; v <= to + 1e-9; v += step) values.push(Number(v.toFixed(2)));
        return values;
    };

    let best = null;
    for (const hard of grid(0.7, 0.99, 0.05)) {
        for (const soft of grid(0.3, 0.9, 0.05)) {
            if (soft >= hard) continue;
            for (const laion of grid(0.05, 0.95, 0.05)) {
                const thresholds = { hard, soft, laion };
                const stats = confusion(rows, model, variant, thresholds, { includeSexy });
                if (!stats.total) continue;
                const score = stats.errors + stats.undecided * 0.5;
                if (!best || score < best.score || (score === best.score && (stats.f1 ?? 0) > (best.stats.f1 ?? 0))) {
                    best = { score, thresholds, stats };
                }
            }
        }
    }
    return best;
}

// ---------------------------------------------------------------- relatório

const pct = (v) => (v === null || v === undefined ? '  —  ' : `${(v * 100).toFixed(1)}%`);
const num = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(4));

// Combinação que a coluna de decisão simula: cai para o que estiver disponível
// se produção não foi incluída na rodada, mas sempre diz qual usou.
function decisionBasis(models, variants) {
    return {
        model: models.includes(PROD_MODEL) ? PROD_MODEL : models[0],
        variant: variants.includes(PROD_VARIANT) ? PROD_VARIANT : variants[0] || null
    };
}

function printPerFile(rows, models, variants) {
    const basis = decisionBasis(models, variants);
    console.log('\n═══ Pontuação por arquivo ═══');
    console.log(`(decisão simulada com ${basis.model} + LAION ${basis.variant || 'ausente'})\n`);

    const table = rows.map((row) => {
        const entry = {
            arquivo: row.file.length > 24 ? `${row.file.slice(0, 21)}...` : row.file,
            rótulo: row.label || '—'
        };
        for (const model of models) {
            const s = row.models[model];
            entry[model] = s ? nsfwScoreFrom(s, { includeSexy: true }).toFixed(3) : '—';
        }
        for (const variant of variants) {
            entry[variant] = num(row.laion[variant]);
        }

        const s = row.models[basis.model];
        if (s) {
            const d = decide(
                nsfwScoreFrom(s, { includeSexy: true }),
                basis.variant ? row.laion[basis.variant] : null,
                CURRENT
            );
            entry.decisão = `${d.blocked === null ? 'INDEF' : d.blocked ? 'BLOQUEIA' : 'libera'} (${d.gate})`;
        }
        return entry;
    });
    console.table(table);
}

function printMetrics(rows, models, variants) {
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

    console.log(`Com os limiares atuais (hard=${CURRENT.hard} soft=${CURRENT.soft} laion=${CURRENT.laion}):\n`);
    const current = [];
    for (const model of models) {
        for (const variant of variants) {
            const s = confusion(rows, model, variant, CURRENT, { includeSexy: true });
            current.push({
                modelo: model,
                variante: variant,
                'falso+': s.fp,
                'falso-': s.fn,
                acertos: s.tp + s.tn,
                indef: s.undecided,
                precisão: pct(s.precision),
                recall: pct(s.recall),
                F1: pct(s.f1)
            });
        }
    }
    console.table(current);

    console.log('\nMelhores limiares encontrados para o seu conjunto:\n');
    const tuned = [];
    for (const model of models) {
        for (const variant of variants) {
            const best = sweep(rows, model, variant, { includeSexy: true });
            if (!best) continue;
            tuned.push({
                modelo: model,
                variante: variant,
                hard: best.thresholds.hard,
                soft: best.thresholds.soft,
                laion: best.thresholds.laion,
                'falso+': best.stats.fp,
                'falso-': best.stats.fn,
                F1: pct(best.stats.f1)
            });
        }
    }
    console.table(tuned);

    console.log('\nHipótese do "Sexy" — a classe entra no bloqueio automático com o mesmo peso de "Porn".');
    console.log('Se tirar ela reduzir falso positivo sem criar falso negativo, o problema não é o modelo:\n');
    const basis = decisionBasis(models, variants);
    const sexyTest = [];
    for (const model of models) {
        for (const includeSexy of [true, false]) {
            const s = confusion(rows, model, basis.variant, CURRENT, { includeSexy });
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
    const { dir, variants, models } = parseArgs(process.argv.slice(2));

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

    const laionScores = {};
    for (const variant of variants) {
        console.log(`🐍 LAION "${variant}" (o primeiro carregamento demora ~90s)...`);
        laionScores[variant] = await scoreWithLaion(variant, images);
    }

    const rows = images.map((image) => ({
        file: image.name,
        label: labels.get(image.name) || '',
        models: Object.fromEntries(
            models.map((m) => [m, modelScores[m].get(image.name) || null])
        ),
        laion: Object.fromEntries(
            variants.map((v) => [v, laionScores[v].get(image.name) ?? null])
        )
    }));

    const basis = decisionBasis(models, variants);
    const decisionCol = `decisao_${basis.model}_${(basis.variant || 'sem_laion').replace(/-/g, '_')}`;
    const gateCol = `portao_${basis.model}_${(basis.variant || 'sem_laion').replace(/-/g, '_')}`;

    const header = [
        'file', 'label',
        // Nome do modelo em cada coluna: sem isso não dá para saber de qual
        // modelo veio o score quando há mais de um na rodada.
        ...models.flatMap((m) => [
            `${m}_neutral`, `${m}_drawing`, `${m}_sexy`, `${m}_hentai`, `${m}_porn`,
            `${m}_nsfwScore`, `${m}_nsfwScoreNoSexy`
        ]),
        ...variants.map((v) => `laion_${v.replace(/-/g, '_')}`),
        decisionCol, gateCol
    ];

    const csvRows = rows.map((row) => {
        const out = { file: row.file, label: row.label };

        for (const modelName of models) {
            const s = row.models[modelName];
            out[`${modelName}_neutral`] = s ? s.Neutral.toFixed(6) : '';
            out[`${modelName}_drawing`] = s ? s.Drawing.toFixed(6) : '';
            out[`${modelName}_sexy`] = s ? s.Sexy.toFixed(6) : '';
            out[`${modelName}_hentai`] = s ? s.Hentai.toFixed(6) : '';
            out[`${modelName}_porn`] = s ? s.Porn.toFixed(6) : '';
            out[`${modelName}_nsfwScore`] = s ? nsfwScoreFrom(s, { includeSexy: true }).toFixed(6) : '';
            out[`${modelName}_nsfwScoreNoSexy`] = s ? nsfwScoreFrom(s, { includeSexy: false }).toFixed(6) : '';
        }

        for (const variant of variants) {
            const value = row.laion[variant];
            out[`laion_${variant.replace(/-/g, '_')}`] = value === null ? '' : value.toFixed(6);
        }

        const baseScores = row.models[basis.model];
        const d = baseScores
            ? decide(
                nsfwScoreFrom(baseScores, { includeSexy: true }),
                basis.variant ? row.laion[basis.variant] : null,
                CURRENT
            )
            : { blocked: null, gate: 'ERRO' };
        out[decisionCol] = d.blocked === null ? 'indefinido' : d.blocked ? 'nsfw' : 'ok';
        out[gateCol] = d.gate;

        return out;
    });

    await writeCsvAtomic(csvPath, header, csvRows);

    printPerFile(rows, models, variants);
    printMetrics(rows, models, variants);

    console.log(`\n💾 CSV atualizado: ${csvPath}`);
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
