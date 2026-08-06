-- CreateTable
CREATE TABLE `game_xadrez` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chatId` VARCHAR(255) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `player1Id` VARCHAR(255) NOT NULL,
    `player2Id` VARCHAR(255) NULL,
    `whiteId` VARCHAR(255) NULL,
    `blackId` VARCHAR(255) NULL,
    `fen` TEXT NOT NULL,
    `movesSan` TEXT NOT NULL,
    `lastMoveFrom` VARCHAR(4) NULL,
    `lastMoveTo` VARCHAR(4) NULL,
    `drawOfferBy` VARCHAR(255) NULL,
    `currentRoundMessageId` VARCHAR(255) NULL,
    `roundMessageIds` TEXT NOT NULL,
    `startedBy` VARCHAR(255) NOT NULL,
    `result` VARCHAR(20) NULL,
    `winnerId` VARCHAR(255) NULL,
    `endReason` VARCHAR(40) NULL,
    `lastMoveAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `game_xadrez_chatId_status_idx`(`chatId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `game_scores` ADD COLUMN `draws` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `losses` INTEGER NOT NULL DEFAULT 0;
