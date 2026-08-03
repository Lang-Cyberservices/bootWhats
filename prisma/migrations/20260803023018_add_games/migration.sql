-- CreateTable
CREATE TABLE `game_forca` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chatId` VARCHAR(255) NOT NULL,
    `mode` VARCHAR(50) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `answer` VARCHAR(255) NOT NULL,
    `answerRef` VARCHAR(255) NULL,
    `guessedLetters` TEXT NOT NULL,
    `wrongLetters` TEXT NOT NULL,
    `wrongGuesses` TEXT NOT NULL,
    `errorsCount` INTEGER NOT NULL DEFAULT 0,
    `lastLetterAuthorId` VARCHAR(255) NULL,
    `currentRoundMessageId` VARCHAR(255) NULL,
    `roundMessageIds` TEXT NOT NULL,
    `startedBy` VARCHAR(255) NOT NULL,
    `winnerId` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_forca_participants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `gameId` INTEGER NOT NULL,
    `authorId` VARCHAR(255) NOT NULL,
    `pointsEarned` INTEGER NOT NULL DEFAULT 0,
    `eliminated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `game_forca_participants_gameId_authorId_key`(`gameId`, `authorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_scores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chatId` VARCHAR(255) NOT NULL,
    `authorId` VARCHAR(255) NOT NULL,
    `gameType` VARCHAR(50) NOT NULL,
    `totalPoints` INTEGER NOT NULL DEFAULT 0,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `matchesPlayed` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `game_scores_chatId_authorId_gameType_key`(`chatId`, `authorId`, `gameType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `game_forca_participants` ADD CONSTRAINT `game_forca_participants_gameId_fkey` FOREIGN KEY (`gameId`) REFERENCES `game_forca`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
