<?php

declare(strict_types=1);

namespace Gestao\Controllers;

use Gestao\Repositories\ProxyRepository;

final class ProxyController
{
    private const PER_PAGE = 100;
    private const FILTERS = ['all', 'active', 'inactive'];
    private const MAX_INVALID_SHOWN = 20;

    public function __construct(private ProxyRepository $proxies)
    {
    }

    public function index(): void
    {
        $error = null;
        $success = null;
        $invalidLines = [];

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $action = (string) ($_POST['action'] ?? '');
            $id = (int) ($_POST['id'] ?? 0);

            if ($action === 'import') {
                [$parsed, $invalidLines] = $this->parseList((string) ($_POST['list'] ?? ''));
                if (!$parsed && !$invalidLines) {
                    $error = 'Lista vazia.';
                } else {
                    $inserted = $parsed ? $this->proxies->importMany($parsed) : 0;
                    $success = sprintf(
                        '%d novo(s), %d já cadastrado(s), %d linha(s) inválida(s).',
                        $inserted,
                        count($parsed) - $inserted,
                        count($invalidLines)
                    );
                }
            } elseif ($action === 'toggle' && $id > 0) {
                $this->proxies->setActive($id, ($_POST['active'] ?? '') === '1');
                $success = 'Proxy #' . $id . ' atualizado.';
            } elseif ($action === 'reset' && $id > 0) {
                $this->proxies->resetCounters($id);
                $success = 'Contadores do proxy #' . $id . ' zerados.';
            } else {
                $error = 'Ação inválida.';
            }
        }

        $filter = (string) ($_GET['filter'] ?? 'all');
        if (!in_array($filter, self::FILTERS, true)) {
            $filter = 'all';
        }

        $total = $this->proxies->count($filter);
        $totalPages = max(1, (int) ceil($total / self::PER_PAGE));
        $page = min($totalPages, max(1, (int) ($_GET['page'] ?? 1)));
        $proxies = $this->proxies->list($filter, self::PER_PAGE, ($page - 1) * self::PER_PAGE);
        $summary = $this->proxies->summary();
        $invalidHidden = max(0, count($invalidLines) - self::MAX_INVALID_SHOWN);
        $invalidLines = array_slice($invalidLines, 0, self::MAX_INVALID_SHOWN);

        require __DIR__ . '/../Views/proxies.php';
    }

    /**
     * Uma linha por proxy, no formato esquema://host:porta.
     *
     * @return array{0: array<int, array{url:string,port:int}>, 1: array<int, string>}
     */
    private function parseList(string $raw): array
    {
        $parsed = [];
        $invalid = [];

        foreach (preg_split('/\R/', $raw) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }

            if (!preg_match('~^(https?|socks4a?|socks5h?)://([a-z0-9.\-]{1,150}):(\d{1,5})/?$~i', $line, $m)
                || (int) $m[3] < 1 || (int) $m[3] > 65535) {
                $invalid[] = $line;
                continue;
            }

            $url = strtolower($m[1]) . '://' . strtolower($m[2]);
            $parsed[$url . ':' . (int) $m[3]] = ['url' => $url, 'port' => (int) $m[3]];
        }

        return [array_values($parsed), $invalid];
    }
}
