-- CreateTable
CREATE TABLE `media_analysis_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `messageId` VARCHAR(191) NOT NULL,
    `md5` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `filePath` VARCHAR(500) NOT NULL,
    `mimetype` VARCHAR(100) NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `phone` VARCHAR(32) NULL,
    `caption` TEXT NULL,
    `isNsfw` BOOLEAN NULL,
    `predictions` LONGTEXT NULL,
    `evidencePath` VARCHAR(500) NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lockedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `media_analysis_jobs_messageId_key`(`messageId`),
    INDEX `media_analysis_jobs_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `media_analysis_jobs_md5_idx`(`md5`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
