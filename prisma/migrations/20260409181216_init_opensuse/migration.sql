-- CreateTable
CREATE TABLE `logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `action` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,
    `content` TEXT NULL,
    `details` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `command_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `command` VARCHAR(191) NOT NULL,
    `args` TEXT NULL,
    `chatId` VARCHAR(191) NULL,
    `chatName` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oracle_predictions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phone` VARCHAR(191) NOT NULL,
    `weekKey` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `luckType` VARCHAR(191) NOT NULL DEFAULT 'SORTE',
    `luckyNumber` INTEGER NOT NULL DEFAULT 0,
    `animalName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `oracle_predictions_phone_weekKey_key`(`phone`, `weekKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `power_animals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `habitat` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_hashes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `md5` VARCHAR(191) NOT NULL,
    `isNsfw` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `media_hashes_md5_key`(`md5`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_stats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chatId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `messagesCount` INTEGER NOT NULL DEFAULT 0,
    `commandsCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `message_stats_chatId_authorId_key`(`chatId`, `authorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- CreateTable
CREATE TABLE `philosopher_protectors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `phrase` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jokes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `text` TEXT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admins` (
    `phone` VARCHAR(32) NOT NULL,
    `authorId` VARCHAR(64) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `expire_password` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`phone`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `welcome_configs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chatId` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `peopleToTrigger` INTEGER NOT NULL DEFAULT 1,
    `counter` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `welcome_configs_chatId_key`(`chatId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `books_top_week` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `week` DATE NOT NULL,
    `book` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `books_top_week_week_book_key`(`week`, `book`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `books_download` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `font` VARCHAR(255) NOT NULL,
    `link` VARCHAR(500) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `book_recomendation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `book` VARCHAR(255) NOT NULL,
    `autoctor` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
