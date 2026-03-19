<?php
/** @var array<int, array{id:int,text:string}> $jokes */
/** @var string|null $error */
/** @var string|null $success */
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Piadas - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: radial-gradient(circle at top, #f5f7ff 0%, #eef2f7 40%, #f8f9fb 100%); }
        .brand { letter-spacing: 0.08em; font-weight: 700; }
        .joke-item { white-space: pre-line; }
    </style>
</head>
<body>
<nav class="navbar navbar-expand-lg bg-white border-bottom shadow-sm">
    <div class="container">
        <span class="navbar-brand brand text-uppercase text-primary">Gestao</span>
        <div class="navbar-nav">
            <a class="nav-link active" aria-current="page" href="/?route=jokes">Piadas</a>
            <a class="nav-link" href="/?route=admins">Admins</a>
            <a class="nav-link" href="/?route=welcome">Boas vindas</a>
            <a class="nav-link" href="/?route=change-password">Trocar senha</a>
            <a class="nav-link text-danger" href="/?route=logout">Sair</a>
        </div>
    </div>
</nav>
<main class="container py-5">
    <div class="row g-4">
        <div class="col-12 col-lg-5">
            <h1 class="h3 mb-3">Gestao de Piadas</h1>
            <p class="text-secondary">Cadastre novas piadas e remova entradas antigas.</p>
            <?php if ($error): ?>
                <div class="alert alert-danger" role="alert">
                    <?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?>
                </div>
            <?php endif; ?>
            <?php if ($success): ?>
                <div class="alert alert-success" role="alert">
                    <?= htmlspecialchars($success, ENT_QUOTES, 'UTF-8') ?>
                </div>
            <?php endif; ?>
            <div class="card border-0 shadow-sm">
                <div class="card-body p-4">
                    <h2 class="h5 mb-3">Adicionar</h2>
                    <form method="post" action="/?route=jokes" class="vstack gap-3">
                        <input type="hidden" name="action" value="create">
                        <textarea class="form-control" name="text" rows="4" required></textarea>
                        <button class="btn btn-primary" type="submit">Salvar</button>
                    </form>
                </div>
            </div>
        </div>
        <div class="col-12 col-lg-7">
            <div class="d-flex align-items-center justify-content-between mb-3">
                <h2 class="h5 mb-0">Lista</h2>
                <span class="badge text-bg-primary"><?= count($jokes) ?></span>
            </div>
            <?php if (!$jokes): ?>
                <div class="card border-0 shadow-sm">
                    <div class="card-body">
                        <p class="mb-0 text-secondary">Nenhuma piada cadastrada.</p>
                    </div>
                </div>
            <?php else: ?>
                <div class="list-group shadow-sm">
                    <?php foreach ($jokes as $joke): ?>
                        <div class="list-group-item d-flex gap-3 align-items-start">
                            <div class="fw-semibold text-primary">#<?= (int) $joke['id'] ?></div>
                            <div class="flex-grow-1 joke-item">
                                <?= htmlspecialchars($joke['text'], ENT_QUOTES, 'UTF-8') ?>
                            </div>
                            <form method="post" action="/?route=jokes">
                                <input type="hidden" name="action" value="delete">
                                <input type="hidden" name="id" value="<?= (int) $joke['id'] ?>">
                                <button class="btn btn-sm btn-outline-danger" type="submit">Remover</button>
                            </form>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>
</main>
</body>
</html>
