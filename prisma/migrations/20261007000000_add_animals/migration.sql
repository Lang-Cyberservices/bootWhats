-- CreateTable
-- `name` em utf8mb4_bin: com utf8mb4_unicode_ci o índice único trataria "sabiá" e "sabia" como
-- iguais, divergindo da deduplicação feita por tools/import_animals.js.
CREATE TABLE `animals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `scientific_name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `img_url` VARCHAR(1024) NULL,

    UNIQUE INDEX `animals_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
