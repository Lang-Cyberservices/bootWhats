-- CreateTable
CREATE TABLE `oracle_themes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `theme` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed data
INSERT INTO `oracle_themes` (`theme`) VALUES
    ('Relacionamento amoroso'),
    ('Amizade'),
    ('Finanças'),
    ('Saúde'),
    ('Trabalho e carreira'),
    ('Estudos e aprendizado'),
    ('Família'),
    ('Desenvolvimento pessoal'),
    ('Espiritualidade'),
    ('Segredos e revelações'),
    ('Decisões importantes'),
    ('Ciclos da vida'),
    ('Propósito de vida'),
    ('Desafios e obstáculos'),
    ('Sorte e oportunidades'),
    ('Destino e futuro');
