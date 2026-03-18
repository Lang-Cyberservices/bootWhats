-- CreateTable
CREATE TABLE `message_stats_buckets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chatId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `periodType` VARCHAR(16) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `messagesCount` INTEGER NOT NULL DEFAULT 0,
    `commandsCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `message_stats_buckets_chatId_authorId_periodType_periodStart_key`(`chatId`, `authorId`, `periodType`, `periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
