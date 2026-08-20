-- CreateTable
CREATE TABLE `game_letreco` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chatId` VARCHAR(255) NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `answer` VARCHAR(255) NOT NULL,
    `answerLetters` VARCHAR(255) NOT NULL,
    `answerRef` VARCHAR(255) NULL,
    `wordLengths` TEXT NOT NULL,
    `guesses` TEXT NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastPlayerId` VARCHAR(255) NULL,
    `lastPlayedAt` DATETIME(3) NULL,
    `currentRoundMessageId` VARCHAR(255) NULL,
    `roundMessageIds` TEXT NOT NULL,
    `startedBy` VARCHAR(255) NOT NULL,
    `winnerId` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `game_letreco_chatId_status_idx`(`chatId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
