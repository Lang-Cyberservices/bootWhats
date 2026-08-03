-- CreateTable
CREATE TABLE `dictionary` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `word` VARCHAR(255) NOT NULL,
    `charactersCount` INTEGER NOT NULL,
    `nounMeaning` TEXT NULL,
    `verbMeaning` TEXT NULL,
    `adjectiveMeaning` TEXT NULL,
    `adverbMeaning` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dictionary_word_key`(`word`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
