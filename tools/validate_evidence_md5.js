const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config();
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');
const nsfw = require('nsfwjs');

function getScore(predictions, className) {
  const found = predictions.find((p) => p.className === className);
  return found ? found.probability : 0;
}

function mergePredictions(base, incoming) {
  if (!base.length) return incoming;
  const byClass = new Map(base.map((p) => [p.className, p.probability]));
  for (const p of incoming) {
    const prev = byClass.get(p.className) ?? 0;
    if (p.probability > prev) byClass.set(p.className, p.probability);
  }
  return Array.from(byClass.entries()).map(([className, probability]) => ({
    className,
    probability
  }));
}

async function getFrameBuffers(buffer, inputSize, isAnimated) {
  if (!isAnimated) {
    const processed = await sharp(buffer)
      .toFormat('png')
      .resize(inputSize, inputSize, { fit: 'fill' })
      .toBuffer();
    return [processed];
  }

  const frameCount = await sharp(buffer, { animated: true })
    .metadata()
    .then((m) => m.pages || 1)
    .catch(() => 1);
  const lastIndex = Math.max(0, frameCount - 1);

  const firstFrame = await sharp(buffer, { animated: true, page: 0 })
    .toFormat('png')
    .resize(inputSize, inputSize, { fit: 'fill' })
    .toBuffer();

  if (lastIndex === 0) return [firstFrame];

  const lastFrame = await sharp(buffer, { animated: true, page: lastIndex })
    .toFormat('png')
    .resize(inputSize, inputSize, { fit: 'fill' })
    .toBuffer();

  return [firstFrame, lastFrame];
}

async function classifyFrames(model, frameBuffers) {
  let predictions = [];
  for (const frameBuffer of frameBuffers) {
    const imageTensor = tf.node.decodeImage(frameBuffer, 3);
    const framePredictions = await model.classify(imageTensor);
    imageTensor.dispose();
    predictions = mergePredictions(predictions, framePredictions);
  }
  return predictions;
}

async function resolveLaionScriptPath(laionScript) {
  const candidate = laionScript;
  const absCandidate = path.isAbsolute(candidate)
    ? candidate
    : path.resolve(process.cwd(), candidate);
  try {
    const stat = await fs.stat(absCandidate);
    if (stat.isDirectory()) {
      return path.join(absCandidate, 'laion_score.py');
    }
  } catch (_) {}
  return absCandidate;
}

async function getLaionScore(buffer, laionPython, laionScript) {
  const execFileAsync = promisify(execFile);
  const tmpName = `${crypto.randomUUID()}.png`;
  const tmpPath = path.join(os.tmpdir(), tmpName);

  await fs.writeFile(tmpPath, buffer);
  try {
    const scriptPath = await resolveLaionScriptPath(laionScript);
    const { stdout } = await execFileAsync(
      laionPython,
      [scriptPath, '--image', tmpPath, '--device', 'cpu'],
      { timeout: 120000 }
    );

    const parsed = JSON.parse(stdout.trim());
    const score = Number(parsed?.score);
    if (Number.isNaN(score)) {
      throw new Error('LAION score inválido');
    }
    return score;
  } finally {
    try {
      await fs.unlink(tmpPath);
    } catch (_) {}
  }
}

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

  const shape =
    model?.model?.inputs?.[0]?.shape ||
    model?.model?.inputShape ||
    model?.inputShape;
  const size = Array.isArray(shape) ? shape[1] : null;
  const inputSize = Number.isFinite(size) ? size : 299;

  const ext = path.extname(resolvedPath).toLowerCase();
  const isAnimated = ext === '.gif' || ext === '.webp';

  const frameBuffers = await getFrameBuffers(buffer, inputSize, isAnimated);
  const predictions = await classifyFrames(model, frameBuffers);

  const pornScore = getScore(predictions, 'Porn');
  const sexyScore = getScore(predictions, 'Sexy');
  const hentaiScore = getScore(predictions, 'Hentai');
  const neutralScore = getScore(predictions, 'Neutral');
  const nsfwScore = Math.max(pornScore, sexyScore, hentaiScore);

  const laionThreshold = Number(process.env.LAION_THRESHOLD ?? 0.5);
  let laionScore = null;
  let laionError = null;
  let blocked = false;
  let reason = 'NSFWJS_PASS';

  if (nsfwScore >= 0.98) {
    blocked = true;
    reason = 'NSFWJS';
  } else if (nsfwScore >= 0.6 && nsfwScore < 0.95) {
    try {
      const laionPython = process.env.LAION_PYTHON || 'python3';
      const laionScript = process.env.LAION_SCRIPT || 'tools/laion_score.py';
      laionScore = await getLaionScore(buffer, laionPython, laionScript);
      if (laionScore >= laionThreshold) {
        blocked = true;
        reason = 'LAION';
      } else {
        blocked = false;
        reason = 'LAION_PASS';
      }
    } catch (err) {
      laionError = err?.message || String(err);
      blocked = null;
      reason = 'LAION_ERROR';
    }
  }

  const sortedPredictions = [...predictions].sort(
    (a, b) => b.probability - a.probability
  );

  const output = {
    file: resolvedPath,
    md5,
    nsfwScore,
    pornScore,
    sexyScore,
    hentaiScore,
    neutralScore,
    laionThreshold,
    laionScore,
    laionError,
    blocked,
    reason,
    predictions: sortedPredictions
  };

  console.log(JSON.stringify(output, null, 2));

  if (blocked === null) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('Erro no teste:', err);
  process.exit(1);
});
