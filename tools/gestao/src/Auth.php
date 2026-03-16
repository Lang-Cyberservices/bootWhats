<?php

declare(strict_types=1);

namespace Gestao;

use Gestao\Repositories\AdminRepository;

final class Auth
{
    public function __construct(private AdminRepository $admins)
    {
    }

    public function login(string $phone, string $password): bool
    {
        $admin = $this->admins->findByPhone($phone);
        if ($admin === null) {
            return false;
        }

        if (!password_verify($password, $admin['password'])) {
            return false;
        }

        $_SESSION['admin_phone'] = $admin['phone'];
        return true;
    }

    public function logout(): void
    {
        unset($_SESSION['admin_phone']);
    }

    public function currentAdminPhone(): ?string
    {
        $phone = $_SESSION['admin_phone'] ?? null;
        return is_string($phone) ? $phone : null;
    }
}
