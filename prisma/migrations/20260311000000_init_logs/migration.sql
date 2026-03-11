CREATE TABLE `logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `action` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,
    `content` TEXT NULL,
    `details` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
