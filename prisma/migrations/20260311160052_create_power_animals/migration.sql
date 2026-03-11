-- CreateTable
CREATE TABLE `power_animals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `habitat` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed initial Brazilian power animals
INSERT INTO `power_animals` (`name`, `description`, `habitat`) VALUES
('Capivara', 'Roedor gigante, símbolo de paz, calma e vida em comunidade. Representa adaptabilidade e convivência harmoniosa.', 'Áreas alagadas, margens de rios e lagos'),
('Arara Azul', 'Ave exuberante que simboliza liberdade, comunicação clara e alegria vibrante.', 'Florestas e cerrados com palmeiras'),
('Cachorro Caramelo', 'Ícone dos vira-latas brasileiros, transmite lealdade, resiliência e coração gigante.', 'Ambientes urbanos e rurais em todo o Brasil'),
('Onça Pintada', 'Grande felino brasileiro, símbolo de coragem, liderança e poder instintivo.', 'Florestas tropicais e matas densas'),
('Tamanduá-Bandeira', 'Animal tranquilo que representa foco, paciência e a capacidade de transformar o incômodo em alimento para a alma.', 'Cerrado, campos e florestas abertas'),
('Mico-Leão-Dourado', 'Pequeno primata de pelagem dourada, remete à preciosidade da vida, energia e proteção familiar.', 'Mata Atlântica'),
('Boto-Cor-de-Rosa', 'Mamífero aquático místico, ligado à intuição, magnetismo pessoal e mistérios do amor.', 'Rios da Amazônia'),
('Tatu-Bola', 'Animal discreto que simboliza proteção, limites saudáveis e autodefesa equilibrada.', 'Caatinga e cerrados'),
('Lobo-Guará', 'Canídeo de longas pernas, associado à independência, elegância e caminhar próprio.', 'Cerrado e campos abertos'),
('Sucuri', 'Grande serpente aquática, representa força silenciosa, transformação profunda e domínio das emoções.', 'Rios, igarapés e áreas alagadas'),
('Jacaré-Açu', 'Réptil imponente que traz a energia da observação paciente e do ataque preciso na hora certa.', 'Rios e lagos amazônicos'),
('Garça-Branca', 'Ave elegante que simboliza pureza de intenções, calma e serenidade emocional.', 'Brejos, margens de rios e lagoas'),
('Tucano', 'Ave de bico marcante, ligada à expressão autêntica, criatividade e presença marcante.', 'Florestas tropicais'),
('Guará (Guaxinim Brasileiro)', 'Pequeno mamífero astuto, associado à curiosidade, improviso e esperteza.', 'Regiões de mata e áreas rurais'),
('Quati', 'Animal sociável e curioso, representa trabalho em grupo, exploração e espírito aventureiro.', 'Florestas, áreas rurais e urbanas'),
('Peixe-Boi Amazônico', 'Gigante gentil das águas doces, simboliza doçura, compaixão e movimentos suaves na vida.', 'Rios e lagos da Amazônia'),
('Ariranha', 'Lontra gigante que representa cooperação, brincadeira e espírito de equipe.', 'Rios amazônicos e pantanais'),
('Capuchinho (Macaco-Prego)', 'Primata inteligente e brincalhão, ligado à criatividade prática e solução de problemas.', 'Matas e florestas diversas'),
('Seriema', 'Ave terrestre que traz energia de coragem, voz ativa e conexão com a terra.', 'Campos e cerrados'),
('Veado-Campeiro', 'Cervo leve e atento, símbolo de sensibilidade, prudência e elegância no movimento.', 'Campos abertos e cerrados'),
('Anta', 'Maior mamífero terrestre da América do Sul, representa força tranquila, grounding e conexão com a floresta.', 'Florestas e áreas alagadas'),
('Cutia', 'Roedor ágil que simboliza organização, reserva de recursos e planejamento do futuro.', 'Matas e áreas rurais'),
('Paca', 'Animal noturno discreto, associado ao recolhimento, silêncio e regeneração.', 'Florestas densas e capoeiras'),
('Guaxinim Sul-Americano', 'Mamífero curioso, símbolo de adaptabilidade, investigação e inteligência prática.', 'Matas e áreas periurbanas'),
('Coruja-Buraqueira', 'Ave observadora que representa sabedoria, percepção aguçada e visão além das aparências.', 'Campos, buracos no solo e áreas abertas'),
('Beija-Flor', 'Pequena ave de voo rápido, ligada à leveza, alegria nas pequenas coisas e energia do momento presente.', 'Jardins, florestas e campos floridos'),
('Raposa-Do-Campo', 'Canídeo ágil e discreto, símbolo de astúcia, estratégia e discrição.', 'Campos e cerrados'),
('Pinguim-de-Magalhães (visita o Brasil)', 'Ave marinha resiliente, ligada à resistência ao frio emocional e união do grupo.', 'Litoral sul brasileiro em certas épocas'),
('Bicho-Preguiça', 'Mamífero de movimentos lentos que ensina a desacelerar, economizar energia e confiar no tempo certo.', 'Florestas tropicais'),
('Guará-Vermelho (Guará-da-Costa)', 'Ave de plumagem vermelha intensa, símbolo de magnetismo, vitalidade e presença marcante.', 'Manguezais e áreas costeiras'),
('Sabiá-Laranjeira', 'Ave símbolo do Brasil, ligada à inspiração, cantos internos e saudade transformada em arte.', 'Jardins, cidades e matas');

