// Sincroniza os membros do grupo do clube do livro com a tabela `users` do
// sistema folhas (CodeIgniter, outro schema no mesmo MariaDB).
//
// - quem esta no grupo e nao tem usuario e cadastrado (role user, senha padrao,
//   troca obrigatoria no primeiro acesso);
// - quem esta no grupo e foi removido volta a ficar ativo;
// - quem saiu do grupo e inativado via soft delete (deleted_at), o mesmo que o
//   painel admin do folhas faz. Admins do folhas e o usuario 1 nunca sao tocados.
//
// O folhas guarda o telefone sem DDI (o DDI vem de countries.code). A
// comparacao de numeros brasileiros ignora o nono digito, porque o WhatsApp
// ainda devolve contas antigas com 8 digitos apos o DDD.
const bcrypt = require('bcryptjs');
const { prisma } = require('./database');

const BRAZIL_CODE = '55';

function digitsOf(value) {
    return String(value || '').replace(/\D/g, '');
}

function serializeId(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    return value._serialized || null;
}

// Chave usada para comparar grupo x banco. Para o Brasil: DDD + ultimos 8
// digitos, assim 11 9XXXX-XXXX e 11 XXXX-XXXX casam.
function matchKey(countryCode, phone) {
    const digits = digitsOf(phone);
    if (countryCode === BRAZIL_CODE && digits.length >= 10) {
        return `${countryCode}:${digits.slice(0, 2)}${digits.slice(-8)}`;
    }
    return `${countryCode}:${digits}`;
}

// Celular brasileiro sem o nono digito (DDD + 8 digitos comecando em 6-9)
// ganha o 9, que e o formato que o membro vai digitar no login.
function toStoredPhone(countryCode, phone) {
    const digits = digitsOf(phone);
    if (countryCode === BRAZIL_CODE && digits.length === 10 && /[6-9]/.test(digits[2])) {
        return `${digits.slice(0, 2)}9${digits.slice(2)}`;
    }
    return digits;
}

function maskPhone(phone) {
    const digits = digitsOf(phone);
    if (digits.length <= 4) return digits;
    return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

class FolhasSync {
    constructor({ client, groupId, dbName, defaultPassword } = {}) {
        this.client = client;
        this.groupId = groupId || process.env.FOLHAS_GROUP_ID || '';
        this.dbName = dbName || process.env.FOLHAS_DB_NAME || 'folhas';
        this.defaultPassword = defaultPassword ?? process.env.FOLHAS_DEFAULT_PASSWORD ?? '';

        // O nome do schema entra interpolado no SQL (nao da para parametrizar identificador).
        if (!/^[A-Za-z0-9_]+$/.test(this.dbName)) {
            throw new Error(`FOLHAS_DB_NAME invalido: ${this.dbName}`);
        }
    }

    table(name) {
        return `\`${this.dbName}\`.\`${name}\``;
    }

    // Hash no formato do PHP: bcryptjs gera $2b$, identico ao $2y$ do password_hash.
    hashDefaultPassword() {
        return bcrypt.hashSync(this.defaultPassword, 10).replace(/^\$2b\$/, '$2y$');
    }

    async loadCountries() {
        const rows = await prisma.$queryRawUnsafe(`SELECT id, code FROM ${this.table('countries')}`);
        return rows
            .map((row) => ({ id: Number(row.id), code: digitsOf(row.code) }))
            .filter((row) => row.code)
            // Prefixo mais longo primeiro: 1 (EUA) nao pode engolir 1242 (Bahamas).
            .sort((a, b) => b.code.length - a.code.length);
    }

    async loadUsers() {
        const rows = await prisma.$queryRawUnsafe(
            `SELECT u.id, u.name, u.phone, u.role, u.deleted_at, c.code AS country_code
               FROM ${this.table('users')} u
               LEFT JOIN ${this.table('countries')} c ON c.id = u.country_id`
        );
        return rows.map((row) => ({
            id: Number(row.id),
            name: row.name,
            phone: digitsOf(row.phone),
            role: row.role,
            deleted: row.deleted_at != null,
            countryCode: digitsOf(row.country_code) || BRAZIL_CODE
        }));
    }

    async resolveContactName(id, fallback) {
        try {
            const contact = await this.client.getContactById(id);
            const label = String(contact?.pushname || contact?.name || '').trim();
            if (label.length >= 3) return label.slice(0, 120);
        } catch (err) {
            console.warn('FolhasSync: falha ao obter contato', id, '-', err?.message || err);
        }
        return fallback;
    }

    // Participantes do grupo -> { phoneFull (com DDI), name, id }. Participantes
    // @lid precisam ser convertidos para telefone; os que nao resolverem voltam
    // em `unresolved`.
    async loadParticipants() {
        const chat = await this.client.getChatById(this.groupId);
        if (!chat?.isGroup) {
            throw new Error(`O chat ${this.groupId} nao e um grupo acessivel pelo bot.`);
        }

        const botDigits = digitsOf(this.client?.info?.wid?.user || this.client?.info?.wid?._serialized);
        const ids = (chat.participants || []).map((p) => serializeId(p?.id)).filter(Boolean);

        const lidIds = ids.filter((id) => id.endsWith('@lid'));
        const pnByLid = new Map();
        if (lidIds.length) {
            const entries = await this.client.getContactLidAndPhone(lidIds);
            lidIds.forEach((id, index) => {
                const pn = entries?.[index]?.pn;
                if (pn) pnByLid.set(id, digitsOf(pn));
            });
        }

        const members = [];
        const unresolved = [];
        for (const id of ids) {
            const phoneFull = id.endsWith('@lid') ? pnByLid.get(id) : digitsOf(id.split('@')[0]);
            if (!phoneFull) {
                unresolved.push({ id, reason: 'LID sem telefone' });
                continue;
            }
            if (botDigits && phoneFull === botDigits) continue;
            members.push({ id, phoneFull });
        }

        return { members, unresolved };
    }

    // Monta o plano (e, com apply, executa). Nunca inativa ninguem se algum
    // participante ficou sem telefone: ele pode ser justamente um usuario ativo.
    async run({ apply = false } = {}) {
        if (!this.client) throw new Error('Cliente do WhatsApp indisponivel.');
        if (!this.groupId) throw new Error('FOLHAS_GROUP_ID nao configurado.');

        const [countries, users, { members, unresolved }] = await Promise.all([
            this.loadCountries(),
            this.loadUsers(),
            this.loadParticipants()
        ]);

        const usersByKey = new Map();
        for (const user of users) {
            usersByKey.set(matchKey(user.countryCode, user.phone), user);
        }

        const toCreate = [];
        const toRestore = [];
        const unchanged = [];
        const presentUserIds = new Set();

        for (const member of members) {
            const country = countries.find((c) => member.phoneFull.startsWith(c.code));
            if (!country) {
                unresolved.push({ id: member.id, reason: 'DDI sem país cadastrado no folhas' });
                continue;
            }

            const national = member.phoneFull.slice(country.code.length);
            const user = usersByKey.get(matchKey(country.code, national));

            if (!user) {
                const phone = toStoredPhone(country.code, national);
                toCreate.push({
                    id: member.id,
                    countryId: country.id,
                    phone,
                    name: await this.resolveContactName(member.id, `Membro ${phone.slice(-4)}`)
                });
                continue;
            }

            presentUserIds.add(user.id);
            if (user.deleted) {
                toRestore.push(user);
            } else {
                unchanged.push(user);
            }
        }

        const toDeactivate = [];
        const skippedAdmins = [];
        for (const user of users) {
            if (user.deleted || presentUserIds.has(user.id)) continue;
            if (user.role === 'admin' || user.id === 1) {
                skippedAdmins.push(user);
                continue;
            }
            toDeactivate.push(user);
        }

        const deactivationBlocked = unresolved.length > 0 && toDeactivate.length > 0;

        const report = {
            applied: false,
            toCreate,
            toRestore,
            toDeactivate: deactivationBlocked ? [] : toDeactivate,
            blockedDeactivations: deactivationBlocked ? toDeactivate : [],
            unchanged,
            unresolved,
            skippedAdmins
        };

        if (!apply) return report;

        if (toCreate.length && this.defaultPassword.length < 6) {
            throw new Error('FOLHAS_DEFAULT_PASSWORD precisa ter ao menos 6 caracteres.');
        }

        const passwordHash = toCreate.length ? this.hashDefaultPassword() : null;
        const usersTable = this.table('users');

        await prisma.$transaction(async (tx) => {
            for (const item of toCreate) {
                await tx.$executeRawUnsafe(
                    `INSERT INTO ${usersTable}
                        (name, country_id, phone, password, must_change_password, role, created_at, updated_at)
                     VALUES (?, ?, ?, ?, 1, 'user', NOW(), NOW())`,
                    item.name, item.countryId, item.phone, passwordHash
                );
            }
            for (const user of toRestore) {
                await tx.$executeRawUnsafe(
                    `UPDATE ${usersTable} SET deleted_at = NULL, updated_at = NOW() WHERE id = ?`,
                    user.id
                );
            }
            for (const user of report.toDeactivate) {
                await tx.$executeRawUnsafe(
                    `UPDATE ${usersTable}
                        SET deleted_at = NOW(), updated_at = NOW(),
                            remember_token = NULL, remember_token_expires_at = NULL
                      WHERE id = ? AND deleted_at IS NULL AND role <> 'admin' AND id <> 1`,
                    user.id
                );
            }
        });

        report.applied = true;
        return report;
    }

    // Votacao ativa do folhas (mesmo criterio de VotingSessionModel::getActiveSession
    // e da contagem de BookSuggestionModel::getSessionSuggestionsWithStats).
    // Devolve null quando nao ha votacao com status 'active'.
    async getActiveVoting() {
        const [session] = await prisma.$queryRawUnsafe(
            `SELECT id FROM ${this.table('voting_sessions')} WHERE status = 'active' ORDER BY id DESC LIMIT 1`
        );
        if (!session) return null;

        const rows = await prisma.$queryRawUnsafe(
            `SELECT s.title, s.author, COUNT(v.id) AS vote_count
               FROM ${this.table('book_suggestions')} s
               LEFT JOIN ${this.table('book_votes')} v ON v.suggestion_id = s.id
              WHERE s.session_id = ?
              GROUP BY s.id
              ORDER BY vote_count DESC, s.created_at ASC`,
            session.id
        );
        return rows.map((row) => ({
            title: row.title,
            author: row.author,
            votes: Number(row.vote_count)
        }));
    }

    static formatVoting(list) {
        const lines = ['📚 *Votação atual*', ''];
        if (!list.length) {
            lines.push('Nenhum livro na votação ainda.');
            return lines.join('\n');
        }

        list.forEach((book, index) => {
            const author = book.author ? ` — ${book.author}` : '';
            lines.push(`${index + 1}. ${book.title}${author}: ${book.votes} ${book.votes === 1 ? 'voto' : 'votos'}`);
        });

        const total = list.reduce((sum, book) => sum + book.votes, 0);
        lines.push('');
        lines.push(`Total: ${total} ${total === 1 ? 'voto' : 'votos'}`);
        return lines.join('\n');
    }

    static formatReport(report) {
        const lines = [];
        lines.push(report.applied ? '📚 *Sincronização do Folhas aplicada*' : '📚 *Prévia da sincronização do Folhas*');
        lines.push('');

        const section = (title, items, label) => {
            lines.push(`${title}: ${items.length}`);
            for (const item of items.slice(0, 30)) lines.push(`  • ${label(item)}`);
            if (items.length > 30) lines.push(`  • … e mais ${items.length - 30}`);
        };

        section('➕ Cadastrar', report.toCreate, (i) => `${i.name} (${maskPhone(i.phone)})`);
        section('♻️ Reativar', report.toRestore, (u) => `${u.name} (${maskPhone(u.phone)})`);
        section('🚫 Inativar', report.toDeactivate, (u) => `${u.name} (${maskPhone(u.phone)})`);
        lines.push(`✅ Já ativos: ${report.unchanged.length}`);

        if (report.skippedAdmins.length) {
            section('🛡️ Admins fora do grupo (mantidos)', report.skippedAdmins, (u) => `${u.name} (${maskPhone(u.phone)})`);
        }

        if (report.unresolved.length) {
            lines.push('');
            lines.push(`⚠️ ${report.unresolved.length} participante(s) sem telefone identificado.`);
            if (report.blockedDeactivations.length) {
                lines.push(`Por segurança, ${report.blockedDeactivations.length} inativação(ões) foram suspensas nesta execução.`);
            }
        }

        if (!report.applied) {
            lines.push('');
            lines.push('Use */folhas atualizar* para gravar.');
        }

        return lines.join('\n');
    }
}

module.exports = FolhasSync;
