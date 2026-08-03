<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class CountryRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @return array<int, array{id:int,name:string,sigla:string,description:?string,flag:?string,createdAt:string,updatedAt:string}> */
    public function listAll(): array
    {
        $stmt = $this->pdo->query(
            'SELECT id, name, sigla, description, flag, createdAt, updatedAt FROM countries ORDER BY name ASC'
        );
        return $stmt->fetchAll();
    }

    /** @return array{id:int,name:string,sigla:string,description:?string,flag:?string,createdAt:string,updatedAt:string}|null */
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, name, sigla, description, flag, createdAt, updatedAt FROM countries WHERE id = :id LIMIT 1'
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row !== false ? $row : null;
    }

    public function create(string $name, string $sigla, ?string $description, ?string $flag): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO countries (name, sigla, description, flag, createdAt, updatedAt) VALUES (:name, :sigla, :description, :flag, NOW(3), NOW(3))'
        );
        $stmt->execute([
            'name' => $name,
            'sigla' => $sigla,
            'description' => $description,
            'flag' => $flag
        ]);
    }

    public function update(int $id, string $name, string $sigla, ?string $description, ?string $flag): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE countries SET name = :name, sigla = :sigla, description = :description, flag = :flag, updatedAt = NOW(3) WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'name' => $name,
            'sigla' => $sigla,
            'description' => $description,
            'flag' => $flag
        ]);
    }
}
