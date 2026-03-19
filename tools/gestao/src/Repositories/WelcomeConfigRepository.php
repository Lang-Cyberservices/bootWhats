<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class WelcomeConfigRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @return array{chatId:string,message:string,peopleToTrigger:int,counter:int,enabled:int}|null */
    public function findByChatId(string $chatId): ?array
    {
        $stmt = $this->pdo->prepare('
            SELECT chatId, message, peopleToTrigger, counter, enabled
            FROM welcome_configs
            WHERE chatId = :chatId
            LIMIT 1
        ');
        $stmt->execute(['chatId' => $chatId]);
        $row = $stmt->fetch();
        if (!is_array($row)) {
            return null;
        }

        return [
            'chatId' => (string) $row['chatId'],
            'message' => (string) $row['message'],
            'peopleToTrigger' => (int) $row['peopleToTrigger'],
            'counter' => (int) $row['counter'],
            'enabled' => (int) $row['enabled']
        ];
    }

    /**
     * @return array<int, array{chatId:string,peopleToTrigger:int,counter:int,enabled:int,updatedAt:string}>
     */
    public function listAll(): array
    {
        $stmt = $this->pdo->query('
            SELECT chatId, peopleToTrigger, counter, enabled, updatedAt
            FROM welcome_configs
            ORDER BY updatedAt DESC
        ');
        $rows = $stmt->fetchAll();
        if (!is_array($rows)) {
            return [];
        }

        return array_map(static function ($row): array {
            return [
                'chatId' => (string) $row['chatId'],
                'peopleToTrigger' => (int) $row['peopleToTrigger'],
                'counter' => (int) $row['counter'],
                'enabled' => (int) $row['enabled'],
                'updatedAt' => (string) $row['updatedAt']
            ];
        }, $rows);
    }

    public function upsert(string $chatId, string $message, int $peopleToTrigger, bool $enabled): void
    {
        $peopleToTrigger = max(1, $peopleToTrigger);
        $enabledInt = $enabled ? 1 : 0;

        $stmt = $this->pdo->prepare('
            INSERT INTO welcome_configs (chatId, message, peopleToTrigger, counter, enabled, updatedAt)
            VALUES (:chatId, :message, :peopleToTrigger, 0, :enabled, NOW(3))
            ON DUPLICATE KEY UPDATE
                message = VALUES(message),
                peopleToTrigger = VALUES(peopleToTrigger),
                enabled = VALUES(enabled),
                updatedAt = NOW(3)
        ');

        $stmt->execute([
            'chatId' => $chatId,
            'message' => $message,
            'peopleToTrigger' => $peopleToTrigger,
            'enabled' => $enabledInt
        ]);
    }
}

