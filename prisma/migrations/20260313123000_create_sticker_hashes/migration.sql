-- CreateTable
CREATE TABLE `sticker_hashes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `md5` VARCHAR(191) NOT NULL,
    `isNsfw` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `sticker_hashes_md5_key`(`md5`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
