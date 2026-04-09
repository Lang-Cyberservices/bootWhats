<?php

declare(strict_types=1);

use Gestao\Auth;
use Gestao\Database;
use Gestao\Middleware;
use Gestao\Controllers\AuthController;
use Gestao\Controllers\AdminController;
use Gestao\Controllers\BooksController;
use Gestao\Controllers\JokeController;
use Gestao\Controllers\SystemController;
use Gestao\Controllers\WelcomeController;
use Gestao\Repositories\AdminRepository;
use Gestao\Repositories\BookRecommendationRepository;
use Gestao\Repositories\BooksDownloadRepository;
use Gestao\Repositories\JokeRepository;
use Gestao\Repositories\WelcomeConfigRepository;

require __DIR__ . '/../src/Config.php';
require __DIR__ . '/../src/Database.php';
require __DIR__ . '/../src/Auth.php';
require __DIR__ . '/../src/Middleware.php';
require __DIR__ . '/../src/Repositories/AdminRepository.php';
require __DIR__ . '/../src/Repositories/BooksDownloadRepository.php';
require __DIR__ . '/../src/Repositories/BookRecommendationRepository.php';
require __DIR__ . '/../src/Repositories/JokeRepository.php';
require __DIR__ . '/../src/Repositories/WelcomeConfigRepository.php';
require __DIR__ . '/../src/Controllers/AuthController.php';
require __DIR__ . '/../src/Controllers/AdminController.php';
require __DIR__ . '/../src/Controllers/BooksController.php';
require __DIR__ . '/../src/Controllers/JokeController.php';
require __DIR__ . '/../src/Controllers/SystemController.php';
require __DIR__ . '/../src/Controllers/WelcomeController.php';

session_start();

$db = new Database();
$adminsRepo = new AdminRepository($db->pdo());
$downloadsRepo = new BooksDownloadRepository($db->pdo());
$recommendationsRepo = new BookRecommendationRepository($db->pdo());
$jokesRepo = new JokeRepository($db->pdo());
$welcomeRepo = new WelcomeConfigRepository($db->pdo());
$auth = new Auth($adminsRepo);
$middleware = new Middleware($adminsRepo);

$authController = new AuthController($auth, $adminsRepo);
$adminController = new AdminController($adminsRepo);
$booksController = new BooksController($downloadsRepo, $recommendationsRepo);
$jokeController = new JokeController($jokesRepo);
$systemController = new SystemController();
$welcomeController = new WelcomeController($welcomeRepo);

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
    case 'books':
        $booksController->index();
        break;
    case 'welcome':
        $welcomeController->index();
        break;
    case 'system':
        $systemController->index();
        break;
    case 'jokes':
    default:
        $jokeController->index();
        break;
}
