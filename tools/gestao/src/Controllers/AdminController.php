<?php

declare(strict_types=1);

namespace Gestao\Controllers;

use Gestao\Repositories\AdminRepository;

final class AdminController
{
    public function __construct(private AdminRepository $admins)
    {
    }

    public function changePassword(): void
    {
        $error = null;
        $success = null;

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $phone = (string) ($_SESSION['admin_phone'] ?? '');
            $current = (string) ($_POST['current_password'] ?? '');
            $next = (string) ($_POST['new_password'] ?? '');
            $confirm = (string) ($_POST['confirm_password'] ?? '');

            if ($phone === '' || $current === '' || $next === '' || $confirm === '') {
                $error = 'Preencha todos os campos.';
            } elseif ($next !== $confirm) {
                $error = 'A confirmacao nao confere.';
            } else {
                $admin = $this->admins->findByPhone($phone);
                if ($admin === null || !password_verify($current, $admin['password'])) {
                    $error = 'Senha atual invalida.';
                } else {
                    $hash = password_hash($next, PASSWORD_DEFAULT);
                    $this->admins->updatePassword($phone, $hash);
                    $success = 'Senha atualizada com sucesso.';
                }
            }
        }

        require __DIR__ . '/../Views/change_password.php';
    }

    public function createAdmin(): void
    {
        $error = null;
        $success = null;

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $action = (string) ($_POST['action'] ?? 'create');

            if ($action === 'reset') {
                $phone = trim((string) ($_POST['phone'] ?? ''));
                $password = (string) ($_POST['password'] ?? '');
                if ($phone === '' || $password === '') {
                    $error = 'Informe telefone e nova senha.';
                } else {
                    $existing = $this->admins->findByPhone($phone);
                    if ($existing === null) {
                        $error = 'Administrador nao encontrado.';
                    } else {
                        $hash = password_hash($password, PASSWORD_DEFAULT);
                        $this->admins->resetPassword($phone, $hash);
                        $success = 'Senha redefinida e expiracao ativada.';
                    }
                }
            } elseif ($action === 'delete') {
                $phone = trim((string) ($_POST['phone'] ?? ''));
                if ($phone === '') {
                    $error = 'Telefone invalido.';
                } else {
                    $this->admins->delete($phone);
                    $success = 'Administrador removido.';
                }
            } else {
                $phone = trim((string) ($_POST['phone'] ?? ''));
                $authorId = trim((string) ($_POST['authorId'] ?? ''));
                $password = (string) ($_POST['password'] ?? '');

                if ($phone === '' || $authorId === '' || $password === '') {
                    $error = 'Preencha todos os campos.';
                } else {
                    $existing = $this->admins->findByPhone($phone);
                    if ($existing !== null) {
                        $error = 'Telefone ja cadastrado.';
                    } else {
                        $hash = password_hash($password, PASSWORD_DEFAULT);
                        $this->admins->create($phone, $authorId, $hash);
                        $success = 'Administrador criado com expire_password = 1.';
                    }
                }
            }
        }

        $admins = $this->admins->listAll();
        require __DIR__ . '/../Views/admins.php';
    }
}
