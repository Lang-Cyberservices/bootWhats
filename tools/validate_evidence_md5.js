const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config();
const nsfw = require('nsfwjs');
const ImageAnalyzer = require('../services/ImageAnalyzer');
const VisionClient = require('../services/analyzer/VisionClient');

// Valida uma imagem local contra o mesmo motor que o worker usa em produção
// (services/ImageAnalyzer.js), sem WhatsApp e sem banco. O portão aqui é mais
// baixo que o de produção de propósito: esta ferramenta serve para inspecionar a
// zona em que o Vision entra em cena.
const VISION_GATE = Number(process.env.NSFW_VISION_GATE ?? 0.3);

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Uso: node tools/validate_evidence_md5.js /caminho/da/imagem');
    process.exit(1);
  }

  const resolvedPath = path.resolve(inputPath);
  const buffer = await fs.readFile(resolvedPath);
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');

  const model = await nsfw.load('file://./models/inception_v3/', {
    type: 'inception_v3',
    size: 299
  });

  const analyzer = new ImageAnalyzer(model, {
    inputSize: 299,
    visionClient: new VisionClient(),
    visionGate: VISION_GATE
  });

  const ext = path.extname(resolvedPath).toLowerCase();
  const verdict = await analyzer.analyze(buffer, {
    mimetype: ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/png',
    filePath: resolvedPath
  });

  const getScore = (className) => {
    const found = verdict.predictions.find((p) => p.className === className);
    return found ? found.probability : 0;
  };

  // Os níveis do Vision são reportados em `safeSearch`; tirá-los da lista mantém
  // `predictions` como a saída crua do NSFWJS.
  const sortedPredictions = verdict.predictions
    .filter((p) => !String(p.className).startsWith('VISION_'))
    .sort((a, b) => b.probability - a.probability);

  const output = {
    file: resolvedPath,
    md5,
    nsfwScore: verdict.nsfwScore,
    pornScore: getScore('Porn'),
    sexyScore: getScore('Sexy'),
    hentaiScore: getScore('Hentai'),
    neutralScore: getScore('Neutral'),
    visionGate: analyzer.visionGate,
    visionAdultLevel: analyzer.adultLevel,
    visionRacyLevel: analyzer.racyLevel,
    safeSearch: verdict.safeSearch,
    visionError: verdict.visionError,
    blocked: verdict.isNsfw,
    reason: verdict.reason,
    predictions: sortedPredictions
  };

  console.log(JSON.stringify(output, null, 2));

  if (verdict.isNsfw === null) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('Erro:', err?.message || err);
  process.exit(1);
});
