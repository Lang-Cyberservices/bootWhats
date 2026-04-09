<?php

declare(strict_types=1);

namespace Gestao\Controllers;

use Gestao\Repositories\BookRecommendationRepository;
use Gestao\Repositories\BooksDownloadRepository;

final class BooksController
{
    public function __construct(
        private BooksDownloadRepository $downloads,
        private BookRecommendationRepository $recommendations
    ) {
    }

    public function index(): void
    {
        $error = null;
        $success = null;
        $selectedDownloadId = (int) ($_GET['downloadId'] ?? 0);
        $selectedRecommendationId = (int) ($_GET['recommendationId'] ?? 0);
        $recommendationMode = (string) ($_GET['recommendationMode'] ?? '');

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $section = (string) ($_POST['section'] ?? '');
            $action = (string) ($_POST['action'] ?? '');

            if ($section === 'download') {
                [$error, $success, $selectedDownloadId] = $this->handleDownloadPost($action);
            } elseif ($section === 'recommendation') {
                [$error, $success, $selectedRecommendationId] = $this->handleRecommendationPost($action);
            }
        }

        $downloads = $this->downloads->listAll();
        $latestRecommendation = $this->recommendations->findLatest();
        $recommendations = $this->recommendations->listAll();

        $download = $selectedDownloadId > 0 ? $this->downloads->findById($selectedDownloadId) : null;
        if ($download === null) {
            $selectedDownloadId = 0;
        }

        $editableRecommendation = null;
        if ($selectedRecommendationId > 0) {
            $candidate = $this->recommendations->findById($selectedRecommendationId);
            if ($candidate !== null && $latestRecommendation !== null && (int) $candidate['id'] === (int) $latestRecommendation['id']) {
                $editableRecommendation = $candidate;
            }
        }

        if ($recommendationMode !== 'create' && $editableRecommendation === null) {
            $editableRecommendation = $latestRecommendation;
        }

        require __DIR__ . '/../Views/books.php';
    }

    /** @return array{0:string|null,1:string|null,2:int} */
    private function handleDownloadPost(string $action): array
    {
        $error = null;
        $success = null;
        $selectedId = 0;

        if ($action === 'deactivate') {
            $id = (int) ($_POST['id'] ?? 0);
            if ($id <= 0) {
                $error = 'Download invalido.';
            } else {
                $this->downloads->deactivate($id);
                $success = 'Link de download inativado.';
            }

            return [$error, $success, 0];
        }

        $font = trim((string) ($_POST['font'] ?? ''));
        $link = trim((string) ($_POST['link'] ?? ''));
        $active = isset($_POST['active']) && $_POST['active'] === '1';

        if ($font === '' || $link === '') {
            return ['Preencha fonte e link.', null, 0];
        }

        if (filter_var($link, FILTER_VALIDATE_URL) === false) {
            return ['Informe uma URL valida para o link.', null, 0];
        }

        if ($action === 'update') {
            $id = (int) ($_POST['id'] ?? 0);
            if ($id <= 0) {
                return ['Download invalido.', null, 0];
            }

            $this->downloads->update($id, $font, $link, $active);
            $selectedId = $id;
            $success = 'Link de download atualizado.';
        } else {
            $this->downloads->create($font, $link, $active);
            $success = 'Link de download cadastrado.';
        }

        return [$error, $success, $selectedId];
    }

    /** @return array{0:string|null,1:string|null,2:int} */
    private function handleRecommendationPost(string $action): array
    {
        $book = trim((string) ($_POST['book'] ?? ''));
        $autoctor = trim((string) ($_POST['autoctor'] ?? ''));
        $description = trim((string) ($_POST['description'] ?? ''));

        if ($book === '' || $autoctor === '' || $description === '') {
            return ['Preencha livro, autor e descricao.', null, 0];
        }

        if ($action === 'update') {
            $id = (int) ($_POST['id'] ?? 0);
            $latest = $this->recommendations->findLatest();
            if ($id <= 0 || $latest === null || (int) $latest['id'] !== $id) {
                return ['Apenas a recomendacao mais recente pode ser editada.', null, 0];
            }

            $this->recommendations->update($id, $book, $autoctor, $description);
            return [null, 'Recomendacao atualizada.', $id];
        }

        $this->recommendations->create($book, $autoctor, $description);
        return [null, 'Nova recomendacao cadastrada.', 0];
    }
}
