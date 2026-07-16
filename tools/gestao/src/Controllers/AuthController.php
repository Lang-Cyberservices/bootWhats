<?php

declare(strict_types=1);

namespace Gestao\Controllers;

use Gestao\Auth;
use Gestao\Repositories\AdminRepository;

final class AuthController
{
    public function __construct(
        private Auth $auth,
        private AdminRepository $admins
    ) {
    }

    public function login(): void
    {
        $error = null;

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $phone = trim((string) ($_POST['phone'] ?? ''));
            $password = (string) ($_POST['password'] ?? '');

            if ($phone === '' || $password === '') {
                $error = 'Preencha telefone e senha.';
            } elseif ($this->auth->login($phone, $password)) {
                header('Location: /?route=jokes');
                exit;
            } else {
                $error = 'Credenciais invalidas.';
            }
        }

        require __DIR__ . '/../Views/login.php';
    }

    public function logout(): void
    {
        $this->auth->logout();
        header('Location: /admin');
        exit;
    }
}
