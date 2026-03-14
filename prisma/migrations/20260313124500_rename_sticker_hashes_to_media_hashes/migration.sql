-- RenameTable
RENAME TABLE `sticker_hashes` TO `media_hashes`;

-- RenameIndex
ALTER TABLE `media_hashes`
    RENAME INDEX `sticker_hashes_md5_key` TO `media_hashes_md5_key`;
