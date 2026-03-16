<?php

declare(strict_types=1);

namespace Gestao;

final class Config
{
    private static bool $envLoaded = false;

    /** @return array{host:string,port:int,db:string,user:string,pass:string} */
    public static function db(): array
    {
        self::loadEnv();

        $url = getenv('DATABASE_URL');
        if ($url === false || $url === '') {
            throw new \RuntimeException('DATABASE_URL nao definida');
        }

        $parts = parse_url($url);
        if ($parts === false || !isset($parts['host'], $parts['path'])) {
            throw new \RuntimeException('DATABASE_URL invalida');
        }

        $host = (string) $parts['host'];
        if ($host === 'localhost') {
            // Force TCP to avoid MySQL socket resolution issues in PHP.
            $host = '127.0.0.1';
        }
        $port = isset($parts['port']) ? (int) $parts['port'] : 3306;
        $db = ltrim((string) $parts['path'], '/');
        $user = isset($parts['user']) ? (string) $parts['user'] : '';
        $pass = isset($parts['pass']) ? (string) $parts['pass'] : '';

        return [
            'host' => $host,
            'port' => $port,
            'db' => $db,
            'user' => $user,
            'pass' => $pass
        ];
    }

    private static function loadEnv(): void
    {
        if (self::$envLoaded) {
            return;
        }
        self::$envLoaded = true;

        $root = dirname(__DIR__, 3);
        $envPath = $root . '/.env';
        if (!is_file($envPath) || !is_readable($envPath)) {
            return;
        }

        $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            return;
        }

        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            $eqPos = strpos($line, '=');
            if ($eqPos === false) {
                continue;
            }

            $key = trim(substr($line, 0, $eqPos));
            $value = trim(substr($line, $eqPos + 1));
            if ($key === '') {
                continue;
            }

            if ((str_starts_with($value, '"') && str_ends_with($value, '"')) ||
                (str_starts_with($value, "'") && str_ends_with($value, "'"))
            ) {
                $value = substr($value, 1, -1);
            }

            if (getenv($key) !== false) {
                continue;
            }

            putenv($key . '=' . $value);
            $_ENV[$key] = $value;
            $_SERVER[$key] = $value;
        }
    }
}
