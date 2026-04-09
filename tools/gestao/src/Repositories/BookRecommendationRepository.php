<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class BookRecommendationRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @return array<int, array{id:int,book:string,autoctor:string,description:string,createdAt:string,updatedAt:string}> */
    public function listAll(): array
    {
        $stmt = $this->pdo->query(
            'SELECT id, book, autoctor, description, createdAt, updatedAt FROM book_recomendation ORDER BY createdAt DESC, id DESC'
        );
        return $stmt->fetchAll();
    }

    /** @return array{id:int,book:string,autoctor:string,description:string,createdAt:string,updatedAt:string}|null */
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, book, autoctor, description, createdAt, updatedAt FROM book_recomendation WHERE id = :id LIMIT 1'
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row !== false ? $row : null;
    }

    /** @return array{id:int,book:string,autoctor:string,description:string,createdAt:string,updatedAt:string}|null */
    public function findLatest(): ?array
    {
        $stmt = $this->pdo->query(
            'SELECT id, book, autoctor, description, createdAt, updatedAt FROM book_recomendation ORDER BY createdAt DESC, id DESC LIMIT 1'
        );
        $row = $stmt->fetch();

        return $row !== false ? $row : null;
    }

    public function create(string $book, string $autoctor, string $description): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO book_recomendation (book, autoctor, description, createdAt, updatedAt) VALUES (:book, :autoctor, :description, NOW(3), NOW(3))'
        );
        $stmt->execute([
            'book' => $book,
            'autoctor' => $autoctor,
            'description' => $description
        ]);
    }

    public function update(int $id, string $book, string $autoctor, string $description): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE book_recomendation SET book = :book, autoctor = :autoctor, description = :description, updatedAt = NOW(3) WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'book' => $book,
            'autoctor' => $autoctor,
            'description' => $description
        ]);
    }
}
