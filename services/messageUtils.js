function getSenderId(msg) {
    // Prefer participant id in groups (c.us) to avoid LID-only ids.
    if (msg?.id?.participant) {
        return msg.id.participant;
    }
    return msg?.author || msg?.from || null;
}

module.exports = {
    getSenderId
};
