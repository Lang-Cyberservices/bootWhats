const { prisma } = require('./database');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSenderId } = require('./messageUtils');

function getCurrentWeekKey(date = new Date()) {
    const year = date.getFullYear();

    // Cálculo simples de semana do ano (1-53)
    const startOfYear = new Date(year, 0, 1);
    const pastDaysOfYear = Math.floor((date - startOfYear) / 86400000);
    const week = Math.floor(pastDaysOfYear / 7) + 1;

    return `${year}-W${week}`;
}

/** Retorna { startDate, endDate, nextDate } para um weekKey (ex: "2025-W11"). */
function getWeekDateRange(weekKey) {
    const match = String(weekKey).match(/^(\d{4})-W(\d{1,2})$/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    const week = parseInt(match[2], 10);
    const startOfYear = new Date(year, 0, 1);
    const startDate = new Date(startOfYear);
    startDate.setDate(startDate.getDate() + (week - 1) * 7);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    const nextDate = new Date(endDate);
    nextDate.setDate(nextDate.getDate() + 1);
    return { startDate, endDate, nextDate };
}

function formatDatePtBr(d) {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Retorna o rodapé com período da previsão e quando pode gerar nova. */
function getDateRangeFooter(weekKey) {
    const range = getWeekDateRange(weekKey);
    if (!range) return '';
    const { startDate, endDate, nextDate } = range;
    return (
        `📅 _Previsão de ${formatDatePtBr(startDate)} a ${formatDatePtBr(endDate)}._\n` +
        `_A partir de ${formatDatePtBr(nextDate)} você poderá gerar uma nova previsão._`
    );
}

class OracleService {
    constructor(auditLogger) {
        this.auditLogger = auditLogger;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            console.warn('GEMINI_API_KEY não configurada. O /oraculo não funcionará sem esta variável.');
        } else {
            const genAI = new GoogleGenerativeAI(apiKey);
            const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
            this.model = genAI.getGenerativeModel({ model: modelName });
        }
    }

    async getWeeklyPrediction(msg, chat) {
        const phone = getSenderId(msg);
        const weekKey = getCurrentWeekKey();

        if (!phone) {
            await msg.reply('📜 “Queres destino, mas nem nome deixas no chão da ágora.” Não consegui identificar você para gerar a previsão.');
            return;
        }

        // 1) Tenta buscar previsão existente para essa semana
        const existing = await prisma.oraclePrediction.findUnique({
            where: {
                phone_weekKey: {
                    phone,
                    weekKey
                }
            }
        });

        if (existing) {
            const footer = getDateRangeFooter(weekKey);
            await msg.reply(footer ? `${existing.message}\n\n${footer}` : existing.message);
            await this.auditLogger?.log('ORACLE_REUSED', {
                chatId: chat?.id?._serialized,
                phone,
                authorId: phone,
                messageId: msg.id?._serialized || msg.id?.id,
                content: msg.body,
                details: { weekKey }
            });
            return;
        }

        // 2) Se não existir, gera nova previsão via Gemini
        if (!this.model) {
            await msg.reply('❌ “Invocas o oráculo, mas esqueces de acender o fogo sagrado .” ');
            return;
        }

        try {
            // Define se a semana puxa mais para sorte ou para azar (desafios)
            const luckType = Math.random() < 0.5 ? 'SORTE' : 'AZAR';

            // Número da sorte de 0 a 99 (formatado com dois dígitos)
            const luckyNumber = Math.floor(Math.random() * 100);
            const luckyNumberStr = String(luckyNumber).padStart(2, '0');

            // Seleciona um animal de poder aleatório
            const totalAnimals = await prisma.powerAnimal.count();
            let animalName = 'Capivara mística';

            if (totalAnimals > 0) {
                const randomIndex = Math.floor(Math.random() * totalAnimals);
                const animals = await prisma.powerAnimal.findMany({
                    skip: randomIndex,
                    take: 1
                });
                if (animals[0]) {
                    animalName = animals[0].name;
                }
            }

            const prompt = `
Você é um oráculo misterioso e bem-humorado.
Gere uma previsão curta (3 a 5 frases) para a semana da pessoa, em português do Brasil.
Evite falar de morte, doenças graves ou temas sensíveis.
De um conselho filosofico no final da previsão.
Use um tom leve, divertido e positivo, como se fosse um horóscopo de jornal.
Não pergunte nada para o usuário, apenas faça a previsão.

Informações de contexto:
- Tema da semana: ${luckType}.
- Animal de poder: ${animalName}.
- Número da sorte: ${luckyNumberStr}.

Importante:
- Não repita o cabeçalho "Oráculo da semana".
- Não fale explicitamente sobre o animal ou o número da sorte.
- Responda apenas com o texto da previsão em parágrafos curtos.
`;

            const result = await this.model.generateContent(prompt);
            const response = result?.response?.text?.() || 'Os astros estão tímidos hoje, volte mais tarde.';

            // Seleciona um filósofo protetor aleatório (não envia ao Gemini)
            const totalPhilosophers = await prisma.philosopherProtector.count();
            let philosopher = null;

            if (totalPhilosophers > 0) {
                const randomIndex = Math.floor(Math.random() * totalPhilosophers);
                const philosophers = await prisma.philosopherProtector.findMany({
                    skip: randomIndex,
                    take: 1
                });
                philosopher = philosophers[0] || null;
            }

            if (!philosopher) {
                await msg.reply('❌ “Invocas o oráculo, mas o templo está vazio.” ');
                return;
            }

            const dateFooter = getDateRangeFooter(weekKey);
            const finalMessage =
`🔮 *Oráculo da semana*\n` +
`🐾 *Animal de poder*: ${animalName}\n` +
`🎲 *Número da sorte*: ${luckyNumberStr}\n\n` +
`${response}\n\n` +
`🛡️ *Filósofo protetor*: ${philosopher.name}\n` +
`_${philosopher.description}_\n\n` +
`💡 *${philosopher.phrase}*` +
(dateFooter ? `\n\n${dateFooter}` : '');

            const created = await prisma.oraclePrediction.create({
                data: {
                    phone,
                    weekKey,
                    message: finalMessage,
                    luckType,
                    luckyNumber,
                    animalName
                }
            });

            await msg.reply(created.message);

            await this.auditLogger?.log('ORACLE_CREATED', {
                chatId: chat?.id?._serialized,
                phone,
                authorId: phone,
                messageId: msg.id?._serialized || msg.id?.id,
                content: msg.body,
                details: { weekKey }
            });
        } catch (err) {
            console.error('Erro ao gerar previsão do oráculo:', err);
            const errText = String(err?.message || '');
            if (err?.status === 429 || errText.includes('Quota exceeded')) {
                await msg.reply('❌ estou cansado agora saia da frente do meu sol.');
                return;
            }
            if (errText.includes('models/') && errText.includes('not found')) {
                await msg.reply(
                    '❌ O modelo Gemini configurado não existe ou não suporta generateContent. Ajuste o `GEMINI_MODEL` na .env usando a lista da API e tente novamente.'
                );
            } else {
                await msg.reply('❌ “Até os deuses têm dias de silêncio.” Não consegui consultar o oráculo agora; tente novamente mais tarde.');
            }
        }
    }
}

module.exports = OracleService;
