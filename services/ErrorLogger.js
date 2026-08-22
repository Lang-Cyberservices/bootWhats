const { prisma } = require('./database');

class ErrorLogger {
    async logError(err, { process: proc, context }) {
        try {
            await prisma.errorLog.create({
                data: {
                    process: proc,
                    context,
                    message: err?.message || String(err),
                    stack: err?.stack || null
                }
            });
        } catch (persistErr) {
            console.error('Erro ao salvar error log:', persistErr.message);
        }
    }
}

module.exports = ErrorLogger;
