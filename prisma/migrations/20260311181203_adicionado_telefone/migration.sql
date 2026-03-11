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

