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

class OracleService {
    constructor(auditLogger) {
        this.auditLogger = auditLogger;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            console.warn('GEMINI_API_KEY não configurada. O /oraculo não funcionará sem esta variável.');
        } else {
            const genAI = new GoogleGenerativeAI(apiKey);
            const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
            this.model = genAI.getGenerativeModel({ model: modelName });
        }
    }

    async getWeeklyPrediction(msg, chat) {
        const phone = getSenderId(msg);
        const weekKey = getCurrentWeekKey();

        if (!phone) {
            await msg.reply('Não consegui ler sua aura para gerar a previsão.');
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
            await msg.reply(`🔮 Sua previsão desta semana é:\n\n${existing.message}`);
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
            await msg.reply('❌ O serviço de oráculo não está configurado corretamente (GEMINI_API_KEY ausente).');
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

            const finalMessage =
`🔮 *Oráculo da semana*\n` +
`🐾 *Animal de poder*: ${animalName}\n` +
`🎲 *Número da sorte*: ${luckyNumberStr}\n\n` +
`${response}`;

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
            await msg.reply('❌ Não consegui consultar o oráculo agora. Tente novamente mais tarde.');
        }
    }
}

module.exports = OracleService;

