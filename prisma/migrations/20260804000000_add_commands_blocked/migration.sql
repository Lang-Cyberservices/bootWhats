-- CreateTable
CREATE TABLE `commands_blocked` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `blockedBy` VARCHAR(191) NULL,
    `blockedByPhone` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `commands_blocked_chatId_name_key`(`chatId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
