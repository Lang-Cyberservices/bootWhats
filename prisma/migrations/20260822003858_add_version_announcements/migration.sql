-- CreateTable
CREATE TABLE `version_announcements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `version` VARCHAR(32) NOT NULL,
    `notes` TEXT NOT NULL,
    `sent` BOOLEAN NOT NULL DEFAULT false,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `version_announcements_version_key`(`version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
