<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class AdminRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @return array{phone:string,authorId:string,password:string,expire_password:int}|null */
    public function findByPhone(string $phone): ?array
    {
        $stmt = $this->pdo->prepare('SELECT phone, authorId, password, expire_password FROM admins WHERE phone = :phone');
        $stmt->execute(['phone' => $phone]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function create(string $phone, string $authorId, string $passwordHash): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO admins (phone, authorId, password, expire_password) VALUES (:phone, :authorId, :password, 1)'
        );
        $stmt->execute([
            'phone' => $phone,
            'authorId' => $authorId,
            'password' => $passwordHash
        ]);
    }

    public function updatePassword(string $phone, string $passwordHash): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE admins SET password = :password, expire_password = 0 WHERE phone = :phone'
        );
        $stmt->execute([
            'phone' => $phone,
            'password' => $passwordHash
        ]);
    }
}
