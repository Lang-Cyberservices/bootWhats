<?php

declare(strict_types=1);

namespace Gestao\Controllers;

final class SystemController
{
    public function index(): void
    {
        $error = null;
        $success = null;
        $restartOutput = null;
        $pm2Bin = getenv('PM2_BIN') ?: 'pm2';
        $pm2Bin = escapeshellcmd($pm2Bin);

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $action = (string) ($_POST['action'] ?? '');
            if ($action === 'restart') {
                $restartOutput = $this->runCommand($pm2Bin . ' restart bootwhats');
                $success = 'Reinicio enviado para o PM2.';
            }
        }

        $statusOutput = $this->runCommand($pm2Bin . ' status bootwhats');

        if ($statusOutput === '') {
            $error = 'Nao foi possivel obter o status do PM2.';
        }

        require __DIR__ . '/../Views/system.php';
    }

    private function runCommand(string $command): string
    {
        $output = [];
        $exitCode = 0;
        exec($command . ' 2>&1', $output, $exitCode);
        $text = trim(implode("\n", $output));
        if ($exitCode !== 0) {
            return $text === '' ? 'Erro ao executar comando.' : $text;
        }
        return $text;
    }
}
