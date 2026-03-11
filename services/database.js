const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não foi definida no .env');
}

const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

async function connectDatabase() {
    await prisma.$connect();
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
}

module.exports = {
    prisma,
    connectDatabase
};
