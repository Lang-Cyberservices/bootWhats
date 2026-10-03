-- CreateTable
CREATE TABLE `proxies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `url` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `success` INTEGER NOT NULL DEFAULT 0,
    `fails` INTEGER NOT NULL DEFAULT 0,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `proxies_active_fails_idx`(`active`, `fails`),
    UNIQUE INDEX `proxies_url_port_key`(`url`, `port`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
