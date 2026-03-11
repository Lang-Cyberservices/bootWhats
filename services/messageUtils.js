function getSenderId(msg) {
    return msg?.author || msg?.from || msg?.id?.participant || null;
}

module.exports = {
    getSenderId
};
