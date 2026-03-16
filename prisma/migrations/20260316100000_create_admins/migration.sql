-- CreateTable
CREATE TABLE `admins` (
    `phone` VARCHAR(32) NOT NULL,
    `authorId` VARCHAR(64) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `expire_password` TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (`phone`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
