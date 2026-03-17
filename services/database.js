const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não foi definida no .env');
}

const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

function isDev() {
    return (process.env.APP_ENV || '').toLowerCase() === 'development';
}

function toFriendlyDbError(err) {
    const message = String(err?.message || '');
    const adapterMsg = String(err?.meta?.driverAdapterError?.message || '');
    const haystack = `${message}\n${adapterMsg}`.toLowerCase();

    if (haystack.includes('pool timeout') || haystack.includes('failed to retrieve a connection')) {
        return (
            'Não consegui conectar ao banco (timeout ao pegar conexão do pool).\n' +
            'Verifique se o Docker do MariaDB/MySQL está ligado e se o `DATABASE_URL` está correto.'
        );
    }

    if (haystack.includes('connect') && (haystack.includes('refused') || haystack.includes('econnrefused'))) {
        return (
            'Não consegui conectar ao banco (conexão recusada).\n' +
            'Verifique se o serviço do banco está rodando e se host/porta do `DATABASE_URL` estão corretos.'
        );
    }

    if (haystack.includes('access denied') || haystack.includes('authentication') || haystack.includes('senha')) {
        return (
            'Não consegui autenticar no banco.\n' +
            'Confira usuário/senha no `DATABASE_URL`.'
        );
    }

    return 'Não consegui conectar ao banco de dados. Confira o Docker/serviço e o `DATABASE_URL`.';
}

async function connectDatabase() {
    try {
        // Prisma pode abrir conexão "lazy"; esta query força um round-trip real ao banco.
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
        console.log('✅ Banco de dados conectado com Prisma (MariaDB).');

        try {
            await prisma.log.create({
                data: {
                    action: 'DB_CONNECTION',
                    content: 'Serviço de conexão iniciado com sucesso.'
                }
            });
        } catch (err) {
            console.error('Aviso: não foi possível registrar log de conexão.', err.message);
        }
    } catch (err) {
        const friendly = toFriendlyDbError(err);
        if (isDev()) {
            console.error('❌ Falha ao conectar no banco de dados:', err);
        } else {
            console.error(`❌ ${friendly}`);
        }
        const wrapped = new Error(friendly);
        wrapped.cause = err;
        throw wrapped;
    }
}

module.exports = {
    prisma,
    connectDatabase
};
