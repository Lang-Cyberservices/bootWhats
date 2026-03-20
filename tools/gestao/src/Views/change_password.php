<?php
/** @var string|null $error */
/** @var string|null $success */
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Troca de Senha</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: radial-gradient(circle at top, #f5f7ff 0%, #eef2f7 40%, #f8f9fb 100%); }
        .brand { letter-spacing: 0.08em; font-weight: 700; }
    </style>
</head>
<body>
<nav class="navbar navbar-expand-lg bg-white border-bottom shadow-sm">
    <div class="container">
        <span class="navbar-brand brand text-uppercase text-primary">Gestao</span>
        <div class="navbar-nav">
            <a class="nav-link" href="/?route=jokes">Piadas</a>
            <a class="nav-link" href="/?route=admins">Admins</a>
            <a class="nav-link" href="/?route=welcome">Boas vindas</a>
            <a class="nav-link" href="/?route=system">Sistema</a>
            <a class="nav-link active" aria-current="page" href="/?route=change-password">Trocar senha</a>
            <a class="nav-link text-danger" href="/?route=logout">Sair</a>
        </div>
    </div>
</nav>
<main class="container py-5">
    <div class="row justify-content-center">
        <div class="col-12 col-lg-6">
            <h1 class="h3 mb-3">Troca de Senha</h1>
            <p class="text-secondary">Atualize sua senha para continuar usando o painel.</p>
            <?php if ($error): ?>
                <div class="alert alert-danger" role="alert">
                    <?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?>
                </div>
            <?php endif; ?>
            <?php if ($success): ?>
                <div class="alert alert-success" role="alert">
                    <?= htmlspecialchars($success, ENT_QUOTES, 'UTF-8') ?>
                </div>
                <a class="btn btn-outline-primary" href="/?route=jokes">Ir para gestao</a>
            <?php endif; ?>
            <div class="card border-0 shadow-sm mt-3">
                <div class="card-body p-4">
                    <form method="post" action="/?route=change-password" class="vstack gap-3">
                        <div>
                            <label class="form-label">Senha atual</label>
                            <input class="form-control" type="password" name="current_password" required>
                        </div>
                        <div>
                            <label class="form-label">Nova senha</label>
                            <input class="form-control" type="password" name="new_password" required>
                        </div>
                        <div>
                            <label class="form-label">Confirmar nova senha</label>
                            <input class="form-control" type="password" name="confirm_password" required>
                        </div>
                        <button class="btn btn-primary" type="submit">Salvar</button>
                    </form>
                </div>
            </div>
        </div>
    </div>
</main>
</body>
</html>
