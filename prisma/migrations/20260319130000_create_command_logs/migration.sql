-- CreateTable
CREATE TABLE `command_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `command` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NULL,
    `chatName` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
