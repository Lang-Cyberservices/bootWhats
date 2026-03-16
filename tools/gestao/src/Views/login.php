<?php
/** @var string|null $error */
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Login - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: radial-gradient(circle at top, #f5f7ff 0%, #eef2f7 40%, #f8f9fb 100%); }
        .brand { letter-spacing: 0.08em; font-weight: 700; }
    </style>
</head>
<body>
<main class="container py-5">
    <div class="row justify-content-center">
        <div class="col-12 col-md-6 col-lg-5">
            <div class="text-center mb-4">
                <div class="brand text-uppercase text-primary">Gestao</div>
                <h1 class="h3 mt-2">Bem-vindo</h1>
                <p class="text-secondary mb-0">Acesse sua conta de administracao</p>
            </div>
            <div class="card shadow-sm border-0">
                <div class="card-body p-4">
                    <?php if ($error): ?>
                        <div class="alert alert-danger" role="alert">
                            <?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?>
                        </div>
                    <?php endif; ?>
                    <form method="post" action="/?route=login" class="vstack gap-3">
                        <div>
                            <label class="form-label">Telefone</label>
                            <input class="form-control" type="text" name="phone" required>
                        </div>
                        <div>
                            <label class="form-label">Senha</label>
                            <input class="form-control" type="password" name="password" required>
                        </div>
                        <button class="btn btn-primary w-100" type="submit">Entrar</button>
                    </form>
                </div>
            </div>
        </div>
    </div>
</main>
</body>
</html>
