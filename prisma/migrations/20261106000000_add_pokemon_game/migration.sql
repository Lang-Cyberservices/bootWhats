-- CreateTable
-- Espelho da PokeAPI preenchido sob demanda pelo /pokemon. `id` é o número da
-- Pokédex nacional, por isso não é AUTO_INCREMENT.
CREATE TABLE `pokemons` (
    `id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `generation` INTEGER NOT NULL,
    `types` VARCHAR(100) NOT NULL,
    `genus` VARCHAR(100) NULL,
    `description_en` TEXT NULL,
    `description` TEXT NULL,
    `description_source` VARCHAR(20) NULL,
    `image_url` VARCHAR(512) NOT NULL,
    `height_dm` INTEGER NULL,
    `weight_hg` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_pokemon` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chatId` VARCHAR(255) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `pokemonId` INTEGER NOT NULL,
    `hintLevel` INTEGER NOT NULL DEFAULT 0,
    `wrongGuesses` TEXT NOT NULL,
    `lastGuessByAuthor` TEXT NOT NULL,
    `currentRoundMessageId` VARCHAR(255) NULL,
    `roundMessageIds` TEXT NOT NULL,
    `startedBy` VARCHAR(255) NOT NULL,
    `winnerId` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `game_pokemon_chatId_status_idx`(`chatId`, `status`),
    INDEX `game_pokemon_pokemonId_fkey`(`pokemonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `game_pokemon` ADD CONSTRAINT `game_pokemon_pokemonId_fkey` FOREIGN KEY (`pokemonId`) REFERENCES `pokemons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
