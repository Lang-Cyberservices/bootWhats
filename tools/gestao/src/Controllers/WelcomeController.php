<?php

declare(strict_types=1);

namespace Gestao\Controllers;

use Gestao\Repositories\WelcomeConfigRepository;

final class WelcomeController
{
    public function __construct(private WelcomeConfigRepository $welcome)
    {
    }

    public function index(): void
    {
        $error = null;
        $success = null;

        $selectedChatId = trim((string) ($_GET['chatId'] ?? ''));

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $chatId = trim((string) ($_POST['chatId'] ?? ''));
            $message = trim((string) ($_POST['message'] ?? ''));
            $peopleToTrigger = (int) ($_POST['peopleToTrigger'] ?? 0);
            $enabled = isset($_POST['enabled']) && $_POST['enabled'] === '1';

            if ($chatId === '') {
                $error = 'Informe o Chat ID do grupo.';
            } elseif ($message === '') {
                $error = 'Informe a mensagem de boas-vindas.';
            } elseif ($peopleToTrigger <= 0) {
                $error = 'Informe um numero valido para visitantes (minimo 1).';
            } else {
                $this->welcome->upsert($chatId, $message, $peopleToTrigger, $enabled);
                $success = 'Configuracao de boas-vindas salva.';
                $selectedChatId = $chatId;
            }
        }

        $configs = $this->welcome->listAll();
        $config = $selectedChatId !== '' ? $this->welcome->findByChatId($selectedChatId) : null;

        require __DIR__ . '/../Views/welcome.php';
    }
}

