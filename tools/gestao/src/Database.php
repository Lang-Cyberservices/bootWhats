<?php

declare(strict_types=1);

namespace Gestao;

use PDO;

final class Database
{
    private PDO $pdo;

    public function __construct()
    {
        $db = Config::db();
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $db['host'],
            $db['port'],
            $db['db']
        );

        $this->pdo = new PDO($dsn, $db['user'], $db['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false
        ]);
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }
}
