<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class ErrorLogRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @return array<int, array{id:int,process:string,context:string,message:string,stack:?string,resolved:int,resolvedAt:?string,createdAt:string}> */
    public function listUnresolved(int $limit, int $offset): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM error_logs WHERE resolved = 0 ORDER BY id DESC LIMIT :limit OFFSET :offset'
        );
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /** @return array<int, array{id:int,process:string,context:string,message:string,stack:?string,resolved:int,resolvedAt:?string,createdAt:string}> */
    public function listAll(int $limit, int $offset): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM error_logs ORDER BY id DESC LIMIT :limit OFFSET :offset'
        );
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function countUnresolved(): int
    {
        return (int) $this->pdo->query('SELECT COUNT(*) FROM error_logs WHERE resolved = 0')->fetchColumn();
    }

    public function countAll(): int
    {
        return (int) $this->pdo->query('SELECT COUNT(*) FROM error_logs')->fetchColumn();
    }

    public function markResolved(int $id): void
    {
        $stmt = $this->pdo->prepare('UPDATE error_logs SET resolved = 1, resolvedAt = NOW() WHERE id = :id');
        $stmt->execute(['id' => $id]);
    }
}
