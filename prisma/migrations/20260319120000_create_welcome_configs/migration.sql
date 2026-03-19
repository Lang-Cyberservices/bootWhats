-- CreateTable
CREATE TABLE `welcome_configs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chatId` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `peopleToTrigger` INTEGER NOT NULL DEFAULT 1,
    `counter` INTEGER NOT NULL DEFAULT 0,
    `enabled` TINYINT(1) NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `welcome_configs_chatId_key`(`chatId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

