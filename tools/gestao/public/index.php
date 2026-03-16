<?php

declare(strict_types=1);

use Gestao\Auth;
use Gestao\Database;
use Gestao\Middleware;
use Gestao\Controllers\AuthController;
use Gestao\Controllers\AdminController;
use Gestao\Controllers\JokeController;
use Gestao\Repositories\AdminRepository;
use Gestao\Repositories\JokeRepository;

require __DIR__ . '/../src/Config.php';
require __DIR__ . '/../src/Database.php';
require __DIR__ . '/../src/Auth.php';
require __DIR__ . '/../src/Middleware.php';
require __DIR__ . '/../src/Repositories/AdminRepository.php';
require __DIR__ . '/../src/Repositories/JokeRepository.php';
require __DIR__ . '/../src/Controllers/AuthController.php';
require __DIR__ . '/../src/Controllers/AdminController.php';
require __DIR__ . '/../src/Controllers/JokeController.php';

session_start();

$db = new Database();
$adminsRepo = new AdminRepository($db->pdo());
$jokesRepo = new JokeRepository($db->pdo());
$auth = new Auth($adminsRepo);
$middleware = new Middleware($adminsRepo);

$authController = new AuthController($auth, $adminsRepo);
$adminController = new AdminController($adminsRepo);
$jokeController = new JokeController($jokesRepo);

$route = (string) ($_GET['route'] ?? 'jokes');

$publicRoutes = ['login'];

if (!in_array($route, $publicRoutes, true)) {
    $middleware->requireAuth($route);
}

switch ($route) {
    case 'login':
        $authController->login();
        break;
    case 'logout':
        $authController->logout();
        break;
    case 'change-password':
        $adminController->changePassword();
        break;
    case 'admins':
        $adminController->createAdmin();
        break;
    case 'jokes':
    default:
        $jokeController->index();
        break;
}
