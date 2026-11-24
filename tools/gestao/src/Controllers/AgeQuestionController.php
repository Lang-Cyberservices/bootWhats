<?php

declare(strict_types=1);

namespace Gestao\Controllers;

use Gestao\Repositories\AgeQuestionRepository;

final class AgeQuestionController
{
    private const MAX_LENGTH = 255;
    // O /sua-idade precisa de 5 ativas para abrir; abaixo disso a página avisa que está em manutenção.
    private const MIN_ACTIVE = 5;

    public function __construct(private AgeQuestionRepository $questions)
    {
    }

    public function index(): void
    {
        $error = null;
        $success = null;

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $action = (string) ($_POST['action'] ?? '');
            $id = (int) ($_POST['id'] ?? 0);
            $text = trim((string) ($_POST['text'] ?? ''));

            if ($action === 'create' || $action === 'update') {
                if ($text === '') {
                    $error = 'Pergunta vazia.';
                } elseif (mb_strlen($text) > self::MAX_LENGTH) {
                    $error = 'Pergunta com mais de ' . self::MAX_LENGTH . ' caracteres.';
                } elseif ($action === 'create') {
                    $this->questions->create($text);
                    $success = 'Pergunta adicionada.';
                } elseif ($id > 0) {
                    $this->questions->updateText($id, $text);
                    $success = 'Pergunta #' . $id . ' atualizada.';
                } else {
                    $error = 'ID invalido.';
                }
            } elseif ($action === 'toggle' && $id > 0) {
                $this->questions->setActive($id, ($_POST['active'] ?? '') === '1');
                $success = 'Pergunta #' . $id . ' atualizada.';
            } elseif ($action === 'delete' && $id > 0) {
                $this->questions->delete($id);
                $success = 'Pergunta #' . $id . ' removida.';
            } else {
                $error = 'Ação inválida.';
            }
        }

        $questions = $this->questions->listAll();
        $activeCount = $this->questions->countActive();
        $minActive = self::MIN_ACTIVE;
        $guessSummary = $this->questions->guessSummary();
        require __DIR__ . '/../Views/age_questions.php';
    }
}
