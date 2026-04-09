<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class BooksDownloadRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @return array<int, array{id:int,font:string,link:string,active:int,createdAt:string,updatedAt:string}> */
    public function listAll(): array
    {
        $stmt = $this->pdo->query('SELECT id, font, link, active, createdAt, updatedAt FROM books_download ORDER BY active DESC, id DESC');
        return $stmt->fetchAll();
    }

    /** @return array{id:int,font:string,link:string,active:int}|null */
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, font, link, active FROM books_download WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row !== false ? $row : null;
    }

    public function create(string $font, string $link, bool $active): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO books_download (font, link, active, createdAt, updatedAt) VALUES (:font, :link, :active, NOW(3), NOW(3))'
        );
        $stmt->execute([
            'font' => $font,
            'link' => $link,
            'active' => $active ? 1 : 0
        ]);
    }

    public function update(int $id, string $font, string $link, bool $active): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE books_download SET font = :font, link = :link, active = :active, updatedAt = NOW(3) WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'font' => $font,
            'link' => $link,
            'active' => $active ? 1 : 0
        ]);
    }

    public function deactivate(int $id): void
    {
        $stmt = $this->pdo->prepare('UPDATE books_download SET active = 0, updatedAt = NOW(3) WHERE id = :id');
        $stmt->execute(['id' => $id]);
    }
}
