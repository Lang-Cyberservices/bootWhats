<?php

declare(strict_types=1);

namespace Gestao\Repositories;

use PDO;

final class VersionRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** Mesma regra do /sobre: a linha mais recente de version_announcements, enviada ou nao. */
    public function latest(): ?string
    {
        try {
            $version = $this->pdo->query('SELECT version FROM version_announcements ORDER BY id DESC LIMIT 1')->fetchColumn();
        } catch (\PDOException $e) {
            return null;
        }

        return is_string($version) && $version !== '' ? $version : null;
    }
}
