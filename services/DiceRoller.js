class DiceRollerError extends Error {}

class DiceRoller {
    constructor() {
        this.maxLines = 20;
        this.maxDicePerBlock = 100;
        this.maxFaces = 1000;
    }

    extractExpression(body) {
        const raw = String(body || '').trim();
        if (!raw.startsWith('/')) {
            return null;
        }

        if (/^\/d(?:\s|$)/i.test(raw)) {
            const expression = raw.slice(2).replace(/\s+/g, '').trim();
            return {
                isDiceCommand: true,
                expression
            };
        }

        const compactExpression = raw.slice(1).replace(/\s+/g, '');
        if (!compactExpression) {
            return null;
        }

        if (this.looksLikeDiceExpression(compactExpression)) {
            return {
                isDiceCommand: true,
                expression: compactExpression
            };
        }

        return null;
    }

    looksLikeDiceExpression(expression) {
        return /^(\d+x)?\d*d\d+([hl]\d+)?(\+\d*d\d+([hl]\d+)?)*(?:[+-]\d+)?$/i.test(String(expression || ''));
    }

    parse(expression) {
        const source = String(expression || '').replace(/\s+/g, '').trim();
        if (!source) {
            throw new DiceRollerError('❓ Use algo como */d 2d6*, */d6* ou */2x2d6h1+2*.'); // eslint-disable-line no-useless-escape
        }

        let lines = 1;
        let rest = source;
        const lineMatch = rest.match(/^(\d+)x(.+)$/i);
        if (lineMatch) {
            lines = Number(lineMatch[1]);
            rest = lineMatch[2];
        }

        if (!Number.isInteger(lines) || lines < 1 || lines > this.maxLines) {
            throw new DiceRollerError(`❌ O multiplicador deve ficar entre 1 e ${this.maxLines}.`);
        }

        let modifier = 0;
        const modifierMatch = rest.match(/([+-]\d+)$/);
        if (modifierMatch) {
            modifier = Number(modifierMatch[1]);
            rest = rest.slice(0, -modifierMatch[1].length);
        }

        if (!rest) {
            throw new DiceRollerError('❌ Faltou informar ao menos um bloco de dados.');
        }

        const blockTexts = rest.split('+').filter(Boolean);
        if (!blockTexts.length) {
            throw new DiceRollerError('❌ Não consegui entender a expressão de dados.');
        }

        const blocks = blockTexts.map((blockText) => this.parseBlock(blockText));
        return { lines, blocks, modifier, original: source };
    }

    parseBlock(blockText) {
        const match = String(blockText || '').match(/^(\d*)d(\d+)(?:([hl])(\d+))?$/i);
        if (!match) {
            throw new DiceRollerError(`❌ Bloco inválido: *${blockText}*.`);
        }

        const quantity = match[1] ? Number(match[1]) : 1;
        const faces = Number(match[2]);
        const filterType = match[3] ? match[3].toLowerCase() : null;
        const filterCount = match[4] ? Number(match[4]) : null;

        if (!Number.isInteger(quantity) || quantity < 1 || quantity > this.maxDicePerBlock) {
            throw new DiceRollerError(`❌ Cada bloco pode rolar entre 1 e ${this.maxDicePerBlock} dados.`);
        }

        if (!Number.isInteger(faces) || faces < 1 || faces > this.maxFaces) {
            throw new DiceRollerError(`❌ Cada dado deve ter entre 1 e ${this.maxFaces} faces.`);
        }

        if (filterType) {
            if (!Number.isInteger(filterCount) || filterCount < 1) {
                throw new DiceRollerError('❌ O filtro high/low precisa de um valor válido.');
            }
            if (filterCount > quantity) {
                throw new DiceRollerError('❌ O filtro high/low não pode selecionar mais resultados do que a quantidade de dados rolados.');
            }
        }

        return {
            notation: `${quantity === 1 ? '' : quantity}d${faces}${filterType ? `${filterType}${filterCount}` : ''}`,
            quantity,
            faces,
            filterType,
            filterCount
        };
    }

    randomInt(max) {
        return Math.floor(Math.random() * max) + 1;
    }

    rollBlock(block) {
        const rolls = Array.from({ length: block.quantity }, () => this.randomInt(block.faces));
        let selected = [...rolls];

        if (block.filterType === 'h') {
            selected = [...rolls].sort((a, b) => b - a).slice(0, block.filterCount);
        } else if (block.filterType === 'l') {
            selected = [...rolls].sort((a, b) => a - b).slice(0, block.filterCount);
        }

        const subtotal = selected.reduce((sum, value) => sum + value, 0);
        const filterLabel = block.filterType
            ? ` ${block.filterType}${block.filterCount} -> [${selected.join('+')}]`
            : '';

        return {
            notation: block.notation,
            rolls,
            selected,
            subtotal,
            text: `${block.notation} [${rolls.join('+')}]${filterLabel} = ${subtotal}`
        };
    }

    rollLine(parsed) {
        const blockResults = parsed.blocks.map((block) => this.rollBlock(block));
        const baseTotal = blockResults.reduce((sum, item) => sum + item.subtotal, 0);
        const finalTotal = baseTotal + parsed.modifier;
        const leftSide = blockResults.map((item) => String(item.subtotal));
        if (parsed.modifier) {
            leftSide.push(parsed.modifier > 0 ? `+${parsed.modifier}` : `${parsed.modifier}`);
        }

        const equation = parsed.modifier
            ? `${baseTotal}${parsed.modifier > 0 ? '+' : ''}${parsed.modifier} = ${finalTotal}`
            : `${finalTotal}`;

        return {
            blockResults,
            baseTotal,
            finalTotal,
            equation,
            summary: leftSide.join(' + ')
        };
    }

    roll(expression) {
        const parsed = this.parse(expression);
        const lines = Array.from({ length: parsed.lines }, () => this.rollLine(parsed));
        return this.formatResult(parsed, lines, expression);
    }

    formatResult(parsed, lines, originalExpression) {
        const expressionLabel = String(originalExpression || parsed.original || '').replace(/\s+/g, '');
        const header = `🎲 *Rolagem:* \`/${expressionLabel}\``;

        if (lines.length === 1) {
            const line = lines[0];
            return [
                header,
                ...line.blockResults.map((item) => `- ${item.text}`),
                `= *${line.equation}*`
            ].join('\n');
        }

        const formattedLines = lines.map((line, index) => {
            const details = line.blockResults.map((item) => item.text).join(' | ');
            return `${index + 1}. ${details} => *${line.equation}*`;
        });

        return [header, ...formattedLines].join('\n');
    }
}

module.exports = DiceRoller;
