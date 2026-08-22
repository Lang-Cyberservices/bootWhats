<?php

declare(strict_types=1);

namespace Gestao\Controllers;

use Gestao\Repositories\ErrorLogRepository;

final class ErrorLogController
{
    private const PER_PAGE = 50;

    public function __construct(private ErrorLogRepository $errors)
    {
    }

    public function index(): void
    {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $action = (string) ($_POST['action'] ?? '');
            if ($action === 'resolve') {
                $id = (int) ($_POST['id'] ?? 0);
                if ($id > 0) {
                    $this->errors->markResolved($id);
                }
            }

            $redirectQuery = ($_POST['all'] ?? '') === '1' ? '&all=1' : '';
            header('Location: /?route=errors' . $redirectQuery);
            exit;
        }

        $showAll = ($_GET['all'] ?? '') === '1';
        $page = max(1, (int) ($_GET['page'] ?? 1));
        $offset = (($page - 1) * self::PER_PAGE);

        $errors = $showAll
            ? $this->errors->listAll(self::PER_PAGE, $offset)
            : $this->errors->listUnresolved(self::PER_PAGE, $offset);

        $total = $showAll ? $this->errors->countAll() : $this->errors->countUnresolved();
        $unresolvedCount = $this->errors->countUnresolved();
        $totalPages = max(1, (int) ceil($total / self::PER_PAGE));

        require __DIR__ . '/../Views/errors.php';
    }
}
