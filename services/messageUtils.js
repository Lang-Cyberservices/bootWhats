function toSerializedId(value) {
    // Builds recentes do whatsapp-web.js devolvem ids @lid como objeto
    // ({ server, user, _serialized }) em vez de string — sem isso o objeto
    // vaza para colunas String do Prisma (ex.: Log.authorId) e quebra o insert.
    if (value == null) return null;
    if (typeof value === 'string') return value;
    return value._serialized || null;
}

function getSenderId(msg) {
    // Prefer participant id in groups (c.us) to avoid LID-only ids.
    if (msg?.id?.participant) {
        return toSerializedId(msg.id.participant);
    }
    return toSerializedId(msg?.author) || toSerializedId(msg?.from);
}

module.exports = {
    getSenderId
};
