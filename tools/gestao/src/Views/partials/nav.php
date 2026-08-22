<?php
/** @var string $activeRoute */

$navItems = [
    'errors' => ['route' => 'errors', 'label' => 'Erros'],
    'jokes' => ['route' => 'jokes', 'label' => 'Piadas'],
    'admins' => ['route' => 'admins', 'label' => 'Admins'],
    'books' => ['route' => 'books', 'label' => 'Livros'],
    'welcome' => ['route' => 'welcome', 'label' => 'Boas vindas'],
    'countries' => ['route' => 'countries', 'label' => 'Paises'],
    'system' => ['route' => 'system', 'label' => 'Sistema'],
];
?>
<nav class="navbar navbar-expand-lg bg-white border-bottom shadow-sm">
    <div class="container">
        <a class="navbar-brand" href="/">Diogenes</a>
        <div class="navbar-nav">
            <?php foreach ($navItems as $key => $item): ?>
                <a class="nav-link<?= $activeRoute === $key ? ' active' : '' ?>"<?= $activeRoute === $key ? ' aria-current="page"' : '' ?> href="/?route=<?= $item['route'] ?>"><?= $item['label'] ?></a>
            <?php endforeach; ?>
            <a class="nav-link<?= $activeRoute === 'change-password' ? ' active' : '' ?>"<?= $activeRoute === 'change-password' ? ' aria-current="page"' : '' ?> href="/?route=change-password">Trocar senha</a>
            <a class="nav-link text-danger" href="/?route=logout">Sair</a>
        </div>
    </div>
</nav>
