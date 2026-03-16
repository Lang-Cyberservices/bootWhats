<?php
/** @var string|null $error */
/** @var string|null $success */
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Admins - Gestao</title>
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
            <a class="nav-link active" aria-current="page" href="/?route=admins">Admins</a>
            <a class="nav-link" href="/?route=change-password">Trocar senha</a>
            <a class="nav-link text-danger" href="/?route=logout">Sair</a>
        </div>
    </div>
</nav>
<main class="container py-5">
    <div class="row g-4">
        <div class="col-12 col-lg-7">
            <h1 class="h3 mb-3">Criar Administrador</h1>
            <p class="text-secondary">Cadastre um novo acesso com telefone, authorId e senha inicial.</p>
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
            <div class="card shadow-sm border-0">
                <div class="card-body p-4">
                    <form method="post" action="/?route=admins" class="vstack gap-3">
                        <div>
                            <label class="form-label">Telefone</label>
                            <input class="form-control" type="text" name="phone" required>
                        </div>
                        <div>
                            <label class="form-label">Author ID</label>
                            <input class="form-control" type="text" name="authorId" required>
                        </div>
                        <div>
                            <label class="form-label">Senha inicial</label>
                            <input class="form-control" type="password" name="password" required>
                        </div>
                        <button class="btn btn-primary" type="submit">Criar</button>
                    </form>
                </div>
            </div>
        </div>
        <div class="col-12 col-lg-5">
            <div class="card border-0 shadow-sm">
                <div class="card-body">
                    <h2 class="h5 mb-3">Boas praticas</h2>
                    <ul class="mb-0 text-secondary">
                        <li>Use telefones no formato internacional.</li>
                        <li>Defina senhas fortes na criacao.</li>
                        <li>Peça a troca no primeiro acesso.</li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</main>
</body>
</html>
