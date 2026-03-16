const fs = require('node:fs/promises');
const path = require('node:path');

async function saveEvidence(buffer, opts = {}) {
    const evidenceDir =
        opts.evidenceDir || process.env.NSFW_EVIDENCE_DIR || './storage/deleted-media';
    await fs.mkdir(evidenceDir, { recursive: true });

    const md5 = typeof opts.md5 === 'string' ? opts.md5.trim() : '';
    const safeMd5 = md5.replace(/[^a-fA-F0-9]/g, '');
    let fileName;
    if (safeMd5) {
        fileName = safeMd5;
    } else {
        const rawMessageId = opts.messageId || `${Date.now()}`;
        const safeMessageId = String(rawMessageId).replace(/[^a-zA-Z0-9._-]/g, '_');
        const extension = getExtension(opts.mimetype);
        fileName = `${Date.now()}_${safeMessageId}.${extension}`;
    }
    const targetPath = path.resolve(evidenceDir, fileName);

    try {
        await fs.access(targetPath);
        return targetPath;
    } catch (_) {
        await fs.writeFile(targetPath, buffer);
    }
    return targetPath;
}

function getExtension(mimetype) {
    if (!mimetype) return 'bin';
    const [, subtype] = mimetype.split('/');
    if (!subtype) return 'bin';
    return subtype.split(';')[0].replace('+xml', '');
}

module.exports = {
    saveEvidence
};
