const { likelihoodValue } = require('./VisionClient');

// Política de moderação de imagens: os números e as regras E/OU moram AQUI, e só aqui.
// Ficam no código (e não no .env) de propósito: a regra tem estrutura, e uma mudança
// de política precisa passar pelo git e subir junto com o deploy.
//
// Duas fontes de sinal:
//  - NSFWJS (local): Porn, Sexy, Hentai em 0..1. É um softmax, então as cinco classes
//    somam 1 — "Porn e Sexy ambos > 0,8" seria impossível, por isso o critério é OU.
//  - Google Vision SafeSearch: níveis convertidos por `likelihoodValue`:
//    UNKNOWN 0 · VERY_UNLIKELY 0,2 · UNLIKELY 0,4 · POSSIBLE 0,6 · LIKELY 0,8 · VERY_LIKELY 1.
//
// O NSFWJS nunca bloqueia sozinho: ele só decide se vale consultar o Vision e, no caso
// do `racy`, confirma o que o Vision disse.
const POLICY = Object.freeze({
    // Consulta o Vision se QUALQUER uma destas classes chegar no valor (>=).
    // Abaixo disso a imagem passa direto.
    visionGate: Object.freeze({ porn: 0.3, sexy: 0.3, hentai: 0.4 }),

    // Bloqueia se VISION_ADULT for MAIOR que isto (> 0,6 = LIKELY ou VERY_LIKELY).
    adultBlockAbove: 0.6,

    // `racy` (sugestivo: praia, academia, decote) sozinho não bloqueia. Precisa de dupla
    // confirmação: Vision com VISION_RACY >= minLikelihood (1 = VERY_LIKELY) E o NSFWJS
    // concordando por um destes dois caminhos.
    racy: Object.freeze({
        minLikelihood: 1,
        confirmPornOrSexyAtLeast: 0.8, // Porn >= 0,8 OU Sexy >= 0,8
        confirmHentaiAbove: 0.9 //        OU Hentai > 0,9
    })
});

function getScore(predictions, className) {
    const found = predictions.find((p) => p.className === className);
    return found ? found.probability : 0;
}

function scoresFrom(predictions) {
    return {
        porn: getScore(predictions, 'Porn'),
        sexy: getScore(predictions, 'Sexy'),
        hentai: getScore(predictions, 'Hentai')
    };
}

/**
 * Decide se a imagem merece a segunda opinião do Vision.
 * `score` é o maior entre Porn/Sexy/Hentai — só para log e para `nsfwScore` no resultado.
 * @returns {{consult: boolean, score: number}}
 */
function shouldConsultVision(predictions) {
    const { porn, sexy, hentai } = scoresFrom(predictions);
    const gate = POLICY.visionGate;
    return {
        consult: porn >= gate.porn || sexy >= gate.sexy || hentai >= gate.hentai,
        score: Math.max(porn, sexy, hentai)
    };
}

/**
 * Veredito final, depois que o Vision respondeu.
 * @param {Array<{className: string, probability: number}>} predictions saída do NSFWJS
 * @param {{adult: string, racy: string}} safeSearch níveis crus do Vision
 * @returns {{isNsfw: boolean, reason: 'VISION_ADULT'|'VISION_RACY_CONFIRMED'|'VISION_PASS'}}
 */
function decide(predictions, safeSearch) {
    const { porn, sexy, hentai } = scoresFrom(predictions);
    const adult = likelihoodValue(safeSearch.adult);
    const racy = likelihoodValue(safeSearch.racy);

    if (adult > POLICY.adultBlockAbove) {
        return { isNsfw: true, reason: 'VISION_ADULT' };
    }

    const rule = POLICY.racy;
    const nsfwjsConfirms =
        porn >= rule.confirmPornOrSexyAtLeast ||
        sexy >= rule.confirmPornOrSexyAtLeast ||
        hentai > rule.confirmHentaiAbove;

    if (racy >= rule.minLikelihood && nsfwjsConfirms) {
        return { isNsfw: true, reason: 'VISION_RACY_CONFIRMED' };
    }

    return { isNsfw: false, reason: 'VISION_PASS' };
}

// Uma linha para o boot do worker: a política ativa precisa estar visível em runtime.
function describePolicy() {
    const { visionGate: g, adultBlockAbove, racy } = POLICY;
    return (
        `consulta o Vision se Porn>=${g.porn} ou Sexy>=${g.sexy} ou Hentai>=${g.hentai}; ` +
        `bloqueia se adult>${adultBlockAbove}, ou se racy>=${racy.minLikelihood} ` +
        `E (Porn ou Sexy>=${racy.confirmPornOrSexyAtLeast} ou Hentai>${racy.confirmHentaiAbove}).`
    );
}

module.exports = { POLICY, getScore, shouldConsultVision, decide, describePolicy };
