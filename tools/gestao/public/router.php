<?php

// Router para o servidor embutido do PHP (php -S): serve arquivos estáticos
// existentes e delega o resto (ex.: /admin) ao index.php.
$file = __DIR__ . parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($file !== __DIR__ . '/' && is_file($file)) {
    return false;
}

require __DIR__ . '/index.php';
