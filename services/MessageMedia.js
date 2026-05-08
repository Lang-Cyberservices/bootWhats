class MessageMedia {
    constructor(mimetype, data, filename = null) {
        this.mimetype = mimetype || 'application/octet-stream';
        this.data = typeof data === 'string' ? data : '';
        this.filename = filename || null;
    }
}

module.exports = {
    MessageMedia
};
