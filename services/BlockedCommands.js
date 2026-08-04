const { prisma } = require('./database');

// Cache em memoria dos comandos fechados por grupo (tabela commands_blocked).
// Hidratado no boot e mantido write-through pelos comandos /fechar e /abrir,
// porque isBlocked() e consultado a cada mensagem de comando e nao pode ir ao banco.
class BlockedCommands {
    constructor() {
        this.blockedByChat = new Map(); // chatId -> Set<name>
        this.disabled = !prisma?.commandBlocked;
    }

    async load() {
        if (this.disabled) {
            console.warn('Aviso: prisma.commandBlocked indisponível. /fechar e /abrir desativados até rodar migrate/generate.');
            return;
        }

        try {
            const rows = await prisma.commandBlocked.findMany();

            this.blockedByChat.clear();
            for (const row of rows) {
                this.addToCache(row.chatId, row.name);
            }

            if (rows.length) {
                console.log(`🔒 Comandos fechados: ${rows.length} bloqueio(s) carregado(s).`);
            }
        } catch (err) {
            console.error('Erro ao carregar comandos fechados:', err?.message || err);
        }
    }

    addToCache(chatId, name) {
        if (!chatId || !name) return;
        const current = this.blockedByChat.get(chatId) || new Set();
        current.add(name);
        this.blockedByChat.set(chatId, current);
    }

    isBlocked(chatId, name) {
        if (this.disabled || !chatId || !name) return false;
        return this.blockedByChat.get(chatId)?.has(name) === true;
    }

    list(chatId) {
        const names = this.blockedByChat.get(chatId);
        return names ? [...names].sort() : [];
    }

    // Persiste primeiro e so entao atualiza o cache: se o banco falhar o erro sobe
    // para o handler e memoria e banco continuam consistentes.
    async block(chatId, name, { blockedBy = null, blockedByPhone = null } = {}) {
        if (this.disabled) throw new Error('Tabela commands_blocked indisponível.');
        if (this.isBlocked(chatId, name)) return false;

        await prisma.commandBlocked.upsert({
            where: { chatId_name: { chatId, name } },
            update: { blockedBy, blockedByPhone },
            create: { chatId, name, blockedBy, blockedByPhone }
        });

        this.addToCache(chatId, name);
        return true;
    }

    async unblock(chatId, name) {
        if (this.disabled) throw new Error('Tabela commands_blocked indisponível.');
        if (!this.isBlocked(chatId, name)) return false;

        await prisma.commandBlocked.deleteMany({ where: { chatId, name } });

        const current = this.blockedByChat.get(chatId);
        if (current) {
            current.delete(name);
            if (!current.size) this.blockedByChat.delete(chatId);
        }
        return true;
    }
}

module.exports = BlockedCommands;
