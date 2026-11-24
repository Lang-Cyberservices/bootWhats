<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class AgeQuestionRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @return array<int, array{id:int,text:string,active:int,createdAt:string}> */
    public function listAll(): array
    {
        $stmt = $this->pdo->query('SELECT id, text, active, createdAt FROM age_questions ORDER BY id DESC');
        return $stmt->fetchAll();
    }

    public function countActive(): int
    {
        return (int) $this->pdo->query('SELECT COUNT(*) FROM age_questions WHERE active = 1')->fetchColumn();
    }

    /** @return array<int, array{id:int,text:string}> */
    public function randomActive(int $limit): array
    {
        $stmt = $this->pdo->prepare('SELECT id, text FROM age_questions WHERE active = 1 ORDER BY RAND() LIMIT :limit');
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /**
     * @param array<int, int> $ids
     * @return array<int, string> texto por id, só das perguntas ativas
     */
    public function textsByIds(array $ids): array
    {
        if (!$ids) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->pdo->prepare("SELECT id, text FROM age_questions WHERE active = 1 AND id IN ($placeholders)");
        $stmt->execute(array_values($ids));

        $texts = [];
        foreach ($stmt->fetchAll() as $row) {
            $texts[(int) $row['id']] = (string) $row['text'];
        }
        return $texts;
    }

    public function create(string $text): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO age_questions (text) VALUES (:text)');
        $stmt->execute(['text' => $text]);
    }

    public function updateText(int $id, string $text): void
    {
        $stmt = $this->pdo->prepare('UPDATE age_questions SET text = :text WHERE id = :id');
        $stmt->execute(['text' => $text, 'id' => $id]);
    }

    public function setActive(int $id, bool $active): void
    {
        $stmt = $this->pdo->prepare('UPDATE age_questions SET active = :active WHERE id = :id');
        $stmt->execute(['active' => $active ? 1 : 0, 'id' => $id]);
    }

    public function delete(int $id): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM age_questions WHERE id = :id');
        $stmt->execute(['id' => $id]);
    }

    public function countGuessesSince(int $seconds, ?string $ipHash = null): int
    {
        $sql = 'SELECT COUNT(*) FROM age_guesses WHERE createdAt > NOW() - INTERVAL :seconds SECOND';
        if ($ipHash !== null) {
            $sql .= ' AND ipHash = :ipHash';
        }

        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(':seconds', $seconds, PDO::PARAM_INT);
        if ($ipHash !== null) {
            $stmt->bindValue(':ipHash', $ipHash);
        }
        $stmt->execute();
        return (int) $stmt->fetchColumn();
    }

    public function createGuess(string $ipHash): int
    {
        $stmt = $this->pdo->prepare('INSERT INTO age_guesses (ipHash) VALUES (:ipHash)');
        $stmt->execute(['ipHash' => $ipHash]);
        return (int) $this->pdo->lastInsertId();
    }

    public function setGuessAge(int $id, int $age): void
    {
        $stmt = $this->pdo->prepare('UPDATE age_guesses SET age = :age WHERE id = :id');
        $stmt->execute(['age' => $age, 'id' => $id]);
    }

    /** @return array{total:int,lastDay:int} */
    public function guessSummary(): array
    {
        $row = $this->pdo->query(
            'SELECT COUNT(*) AS total, SUM(createdAt > NOW() - INTERVAL 1 DAY) AS lastDay FROM age_guesses WHERE age IS NOT NULL'
        )->fetch();

        return ['total' => (int) $row['total'], 'lastDay' => (int) $row['lastDay']];
    }
}
