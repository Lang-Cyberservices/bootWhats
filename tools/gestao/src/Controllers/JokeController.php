<?php

declare(strict_types=1);

namespace Gestao\Controllers;

use Gestao\Repositories\JokeRepository;

final class JokeController
{
    public function __construct(private JokeRepository $jokes)
    {
    }

    public function index(): void
    {
        $error = null;
        $success = null;

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $action = (string) ($_POST['action'] ?? '');
            if ($action === 'create') {
                $text = trim((string) ($_POST['text'] ?? ''));
                if ($text === '') {
                    $error = 'Conteudo vazio.';
                } else {
                    $this->jokes->create($text);
                    $success = 'Piada adicionada.';
                }
            } elseif ($action === 'delete') {
                $id = (int) ($_POST['id'] ?? 0);
                if ($id > 0) {
                    $this->jokes->delete($id);
                    $success = 'Piada removida.';
                } else {
                    $error = 'ID invalido.';
                }
            }
        }

        $jokes = $this->jokes->listAll();
        require __DIR__ . '/../Views/jokes.php';
    }
}
