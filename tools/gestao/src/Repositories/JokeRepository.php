<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class JokeRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @return array<int, array{id:int,text:string}> */
    public function listAll(): array
    {
        $stmt = $this->pdo->query('SELECT id, text FROM jokes ORDER BY id DESC');
        return $stmt->fetchAll();
    }

    public function create(string $text): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO jokes (text) VALUES (:text)');
        $stmt->execute(['text' => $text]);
    }

    public function delete(int $id): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM jokes WHERE id = :id');
        $stmt->execute(['id' => $id]);
    }
}
