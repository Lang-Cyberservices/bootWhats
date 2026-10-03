const { prisma } = require('./database');

// Pool de proxies gratuitos usado pelo yt-dlp (/video e /musica). Unico modulo
// que toca a tabela `proxies`: o ranking e success - fails, e a lista se limpa
// sozinha conforme os proxies mortos vao acumulando falhas.
const BEST_COUNT = 5;
const EXPLORE_COUNT = 5;
const POOL_SIZE = BEST_COUNT + EXPLORE_COUNT;
// Proxy que falhou esse tanto sem nunca ter funcionado sai da rotacao.
const DEACTIVATE_AFTER_FAILS = 3;

function toUrl(proxy) {
    return `${proxy.url}:${proxy.port}`;
}

function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// Devolve ate POOL_SIZE proxies ativos, ja na ordem em que devem ser tentados:
// os BEST_COUNT de maior saldo (empate resolve pelo menor id), depois
// EXPLORE_COUNT sorteados entre os que nunca falharam — e assim que a lista
// inteira vai sendo testada aos poucos. Se faltarem proxies sem falha, completa
// com os proximos do ranking.
async function pickCandidates() {
    const ranked = await prisma.$queryRaw`
        SELECT id, url, port
        FROM proxies
        WHERE active = 1
        ORDER BY (success - fails) DESC, id ASC
        LIMIT ${POOL_SIZE}
    `;

    const best = ranked.slice(0, BEST_COUNT);
    const bestIds = best.map((proxy) => proxy.id);

    const untouched = await prisma.proxy.findMany({
        where: { active: true, fails: 0, id: { notIn: bestIds } },
        select: { id: true, url: true, port: true }
    });
    const explore = shuffle(untouched).slice(0, EXPLORE_COUNT);

    const picked = [...best, ...explore];
    const pickedIds = new Set(picked.map((proxy) => proxy.id));
    for (const proxy of ranked) {
        if (picked.length >= POOL_SIZE) break;
        if (pickedIds.has(proxy.id)) continue;
        picked.push(proxy);
        pickedIds.add(proxy.id);
    }

    return picked.map((proxy) => ({ id: Number(proxy.id), url: proxy.url, port: Number(proxy.port) }));
}

async function recordSuccess(id) {
    try {
        await prisma.proxy.update({
            where: { id },
            data: { success: { increment: 1 }, lastUsedAt: new Date() }
        });
    } catch (err) {
        console.warn('Falha ao registrar sucesso do proxy:', err?.message || err);
    }
}

async function recordFail(id) {
    try {
        // O MariaDB avalia as atribuicoes da esquerda para a direita: quando o
        // IF roda, `fails` ja e o valor incrementado.
        await prisma.$executeRaw`
            UPDATE proxies
            SET fails = fails + 1,
                lastUsedAt = ${new Date()},
                active = IF(success = 0 AND fails >= ${DEACTIVATE_AFTER_FAILS}, 0, active)
            WHERE id = ${id}
        `;
    } catch (err) {
        console.warn('Falha ao registrar falha do proxy:', err?.message || err);
    }
}

module.exports = { pickCandidates, recordSuccess, recordFail, toUrl, POOL_SIZE };
