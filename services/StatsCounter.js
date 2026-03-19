const { prisma } = require('./database');

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_MAX_BUFFER = 50_000;

class StatsCounter {
    constructor(options = {}) {
        const rawInterval = Number(options.flushIntervalMs);
        const rawMaxBuffer = Number(options.maxBuffer);

        this.flushIntervalMs = Number.isFinite(rawInterval) && rawInterval > 0
            ? rawInterval
            : DEFAULT_FLUSH_INTERVAL_MS;
        this.maxBuffer = Number.isFinite(rawMaxBuffer) && rawMaxBuffer > 0
            ? rawMaxBuffer
            : DEFAULT_MAX_BUFFER;

        this._pending = new Map();
        this._flushInProgress = false;
        this._disabled = !prisma?.messageStats;
        if (this._disabled) {
            console.warn('Aviso: prisma.messageStats indisponível. Contadores de mensagens desativados até rodar migrate/generate.');
        }
        this._timer = setInterval(() => {
            this.flushNow().catch((err) => {
                console.error('Falha ao flush de contadores:', err?.message || err);
            });
        }, this.flushIntervalMs);
        this._timer.unref?.();
    }

    trackMessage({ chatId, authorId, phone, isCommand }) {
        if (this._disabled) return;
        if (!chatId || !authorId) return;
        const key = `${chatId}:${authorId}`;
        const current = this._pending.get(key) || {
            chatId,
            authorId,
            phone: phone || null,
            messages: 0,
            commands: 0
        };
        if (!current.phone && phone) {
            current.phone = phone;
        }
        current.messages += 1;
        if (isCommand) current.commands += 1;
        this._pending.set(key, current);

        if (this._pending.size >= this.maxBuffer) {
            this.flushNow().catch((err) => {
                console.error('Falha ao flush de contadores (buffer cheio):', err?.message || err);
            });
        }
    }

    async flushNow() {
        if (this._disabled) return;
        if (this._flushInProgress) return;
        if (this._pending.size === 0) return;

        const batch = this._pending;
        this._pending = new Map();
        this._flushInProgress = true;

        try {
            const now = new Date();
            const dayStart = new Date(now);
            dayStart.setHours(0, 0, 0, 0);
            const monthStart = new Date(now);
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);
            const weekStart = new Date(now);
            const day = weekStart.getDay(); // 0=Dom, 1=Seg, ...
            const diff = day === 0 ? -6 : 1 - day; // segunda como início da semana
            weekStart.setDate(weekStart.getDate() + diff);
            weekStart.setHours(0, 0, 0, 0);

            const ops = [];
            for (const entry of batch.values()) {
                ops.push(
                    prisma.messageStats.upsert({
                        where: {
                            chatId_authorId: {
                                chatId: entry.chatId,
                                authorId: entry.authorId
                            }
                        },
                        create: {
                            chatId: entry.chatId,
                            authorId: entry.authorId,
                            phone: entry.phone || null,
                            messagesCount: entry.messages,
                            commandsCount: entry.commands
                        },
                        update: {
                            messagesCount: { increment: entry.messages },
                            commandsCount: { increment: entry.commands },
                            ...(entry.phone ? { phone: entry.phone } : {})
                        }
                    })
                );

                if (prisma?.messageStatsBucket) {
                    ops.push(
                        prisma.messageStatsBucket.upsert({
                            where: {
                                chatId_authorId_periodType_periodStart: {
                                    chatId: entry.chatId,
                                    authorId: entry.authorId,
                                    periodType: 'day',
                                    periodStart: dayStart
                                }
                            },
                            create: {
                                chatId: entry.chatId,
                                authorId: entry.authorId,
                                phone: entry.phone || null,
                                periodType: 'day',
                                periodStart: dayStart,
                                messagesCount: entry.messages,
                                commandsCount: entry.commands
                            },
                            update: {
                                messagesCount: { increment: entry.messages },
                                commandsCount: { increment: entry.commands },
                                ...(entry.phone ? { phone: entry.phone } : {})
                            }
                        })
                    );

                    ops.push(
                        prisma.messageStatsBucket.upsert({
                            where: {
                                chatId_authorId_periodType_periodStart: {
                                    chatId: entry.chatId,
                                    authorId: entry.authorId,
                                    periodType: 'week',
                                    periodStart: weekStart
                                }
                            },
                            create: {
                                chatId: entry.chatId,
                                authorId: entry.authorId,
                                phone: entry.phone || null,
                                periodType: 'week',
                                periodStart: weekStart,
                                messagesCount: entry.messages,
                                commandsCount: entry.commands
                            },
                            update: {
                                messagesCount: { increment: entry.messages },
                                commandsCount: { increment: entry.commands },
                                ...(entry.phone ? { phone: entry.phone } : {})
                            }
                        })
                    );

                    ops.push(
                        prisma.messageStatsBucket.upsert({
                            where: {
                                chatId_authorId_periodType_periodStart: {
                                    chatId: entry.chatId,
                                    authorId: entry.authorId,
                                    periodType: 'month',
                                    periodStart: monthStart
                                }
                            },
                            create: {
                                chatId: entry.chatId,
                                authorId: entry.authorId,
                                phone: entry.phone || null,
                                periodType: 'month',
                                periodStart: monthStart,
                                messagesCount: entry.messages,
                                commandsCount: entry.commands
                            },
                            update: {
                                messagesCount: { increment: entry.messages },
                                commandsCount: { increment: entry.commands },
                                ...(entry.phone ? { phone: entry.phone } : {})
                            }
                        })
                    );
                }
            }

            await prisma.$transaction(ops);
        } catch (err) {
            // Reverte os contadores para não perder dados.
            for (const entry of batch.values()) {
                const key = `${entry.chatId}:${entry.authorId}`;
                const current = this._pending.get(key) || {
                    chatId: entry.chatId,
                    authorId: entry.authorId,
                    messages: 0,
                    commands: 0
                };
                current.messages += entry.messages;
                current.commands += entry.commands;
                this._pending.set(key, current);
            }
            throw err;
        } finally {
            this._flushInProgress = false;
        }
    }

    async stop() {
        clearInterval(this._timer);
        await this.flushNow();
    }
}

module.exports = StatsCounter;
