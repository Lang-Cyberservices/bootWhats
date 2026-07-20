<?php

declare(strict_types=1);

namespace Gestao;

use Gestao\Repositories\AdminRepository;

final class Middleware
{
    public function __construct(private AdminRepository $admins)
    {
    }

    public function requireAuth(string $route): void
    {
        $phone = $_SESSION['admin_phone'] ?? null;
        if (!is_string($phone) || $phone === '') {
            $this->redirectToLogin();
        }

        $admin = $this->admins->findByPhone($phone);
        if ($admin === null) {
            unset($_SESSION['admin_phone']);
            $this->redirectToLogin();
        }

        $expire = (int) $admin['expire_password'];
        if ($expire === 1 && $route !== 'change-password' && $route !== 'logout') {
            $this->redirect('change-password');
        }
    }

    private function redirect(string $route): void
    {
        header('Location: /?route=' . $route);
        exit;
    }

    private function redirectToLogin(): void
    {
        header('Location: /admin');
        exit;
    }
}
