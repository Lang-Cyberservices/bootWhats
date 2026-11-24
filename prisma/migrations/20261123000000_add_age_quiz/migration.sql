-- CreateTable
CREATE TABLE `age_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `text` VARCHAR(255) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `age_guesses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ipHash` VARCHAR(64) NOT NULL,
    `age` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `age_guesses_ipHash_createdAt_idx`(`ipHash`, `createdAt`),
    INDEX `age_guesses_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Perguntas iniciais
INSERT INTO `age_questions` (`text`) VALUES
    ('Cite 3 desenhos da sua infância'),
    ('A novela que mais chamou sua atenção'),
    ('Apresentadora infantil que você assistia'),
    ('Primeiro videogame que você jogou (ou queria ter)'),
    ('Como você ouvia música aos 12 anos'),
    ('Primeira rede social ou mensageiro que você usou'),
    ('Um brinquedo que era febre na sua escola'),
    ('Qual jogador de futebol você lembra da sua infância'),
    ('Um salgadinho ou doce que sumiu do mercado'),
    ('Um hit que tocava em toda festa da sua adolescência'),
    ('Seu primeiro celular (modelo ou como era)'),
    ('Um programa de auditório de domingo da sua adolescência'),
    ('Um filme que você viu na infância'),
    ('Uma gíria que você usava e hoje dá vergonha');
