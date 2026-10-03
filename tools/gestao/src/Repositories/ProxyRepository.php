<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class ProxyRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    private function whereFor(string $filter): string
    {
        return match ($filter) {
            'active' => 'WHERE active = 1',
            'inactive' => 'WHERE active = 0',
            default => '',
        };
    }

    /**
     * Mesma ordem que o bot usa para escolher (services/ProxyPool.js).
     *
     * @return array<int, array{id:int,url:string,port:int,active:int,success:int,fails:int,lastUsedAt:?string,createdAt:string}>
     */
    public function list(string $filter, int $limit, int $offset): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM proxies ' . $this->whereFor($filter)
            . ' ORDER BY (success - fails) DESC, id ASC LIMIT :limit OFFSET :offset'
        );
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function count(string $filter): int
    {
        return (int) $this->pdo->query('SELECT COUNT(*) FROM proxies ' . $this->whereFor($filter))->fetchColumn();
    }

    /** @return array{total:int,active:int,inactive:int,untested:int} */
    public function summary(): array
    {
        $row = $this->pdo->query(
            'SELECT COUNT(*) AS total,
                    COALESCE(SUM(active = 1), 0) AS active,
                    COALESCE(SUM(active = 0), 0) AS inactive,
                    COALESCE(SUM(active = 1 AND success = 0 AND fails = 0), 0) AS untested
             FROM proxies'
        )->fetch();

        return array_map('intval', $row);
    }

    public function setActive(int $id, bool $active): void
    {
        $stmt = $this->pdo->prepare('UPDATE proxies SET active = :active WHERE id = :id');
        $stmt->bindValue(':active', $active ? 1 : 0, PDO::PARAM_INT);
        $stmt->bindValue(':id', $id, PDO::PARAM_INT);
        $stmt->execute();
    }

    public function resetCounters(int $id): void
    {
        $stmt = $this->pdo->prepare('UPDATE proxies SET success = 0, fails = 0, active = 1 WHERE id = :id');
        $stmt->execute(['id' => $id]);
    }

    /**
     * @param array<int, array{url:string,port:int}> $proxies
     * @return int quantos eram novos (os ja cadastrados sao ignorados)
     */
    public function importMany(array $proxies): int
    {
        $stmt = $this->pdo->prepare('INSERT IGNORE INTO proxies (url, port) VALUES (:url, :port)');
        $inserted = 0;

        $this->pdo->beginTransaction();
        try {
            foreach ($proxies as $proxy) {
                $stmt->bindValue(':url', $proxy['url']);
                $stmt->bindValue(':port', $proxy['port'], PDO::PARAM_INT);
                $stmt->execute();
                $inserted += $stmt->rowCount();
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return $inserted;
    }
}
