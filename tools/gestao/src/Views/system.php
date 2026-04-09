<?php
/** @var string|null $error */
/** @var string|null $success */
/** @var string|null $restartOutput */
/** @var string $statusOutput */
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Sistema - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: radial-gradient(circle at top, #f5f7ff 0%, #eef2f7 40%, #f8f9fb 100%); }
        .brand { letter-spacing: 0.08em; font-weight: 700; }
        .status-box { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    </style>
</head>
<body>
<nav class="navbar navbar-expand-lg bg-white border-bottom shadow-sm">
    <div class="container">
        <span class="navbar-brand brand text-uppercase text-primary">Gestao</span>
        <div class="navbar-nav">
            <a class="nav-link" href="/?route=jokes">Piadas</a>
            <a class="nav-link" href="/?route=admins">Admins</a>
            <a class="nav-link" href="/?route=books">Livros</a>
            <a class="nav-link" href="/?route=welcome">Boas vindas</a>
            <a class="nav-link active" aria-current="page" href="/?route=system">Sistema</a>
            <a class="nav-link" href="/?route=change-password">Trocar senha</a>
            <a class="nav-link text-danger" href="/?route=logout">Sair</a>
        </div>
    </div>
</nav>
<main class="container py-5">
    <div class="row g-4">
        <div class="col-12 col-lg-5">
            <h1 class="h3 mb-3">Sistema</h1>
            <p class="text-secondary">Status do PM2 e acoes rapidas para o servico.</p>
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
            <div class="card border-0 shadow-sm mb-4">
                <div class="card-body p-4">
                    <h2 class="h5 mb-3">Reiniciar servico</h2>
                    <form method="post" action="/?route=system" class="vstack gap-3">
                        <input type="hidden" name="action" value="restart">
                        <button class="btn btn-danger" type="submit">Reiniciar BootWhats</button>
                    </form>
                </div>
            </div>
            <?php if ($restartOutput): ?>
                <div class="card border-0 shadow-sm">
                    <div class="card-body p-3">
                        <div class="fw-semibold mb-2">Saida do reinicio</div>
                        <pre class="status-box mb-0"><?= htmlspecialchars($restartOutput, ENT_QUOTES, 'UTF-8') ?></pre>
                    </div>
                </div>
            <?php endif; ?>
        </div>
        <div class="col-12 col-lg-7">
            <div class="card border-0 shadow-sm">
                <div class="card-body p-4">
                    <div class="d-flex align-items-center justify-content-between mb-3">
                        <h2 class="h5 mb-0">Status do PM2</h2>
                        <span class="badge text-bg-primary">bootwhats</span>
                    </div>
                    <pre class="status-box mb-0"><?= htmlspecialchars($statusOutput ?? '', ENT_QUOTES, 'UTF-8') ?></pre>
                </div>
            </div>
        </div>
    </div>
</main>
</body>
</html>
