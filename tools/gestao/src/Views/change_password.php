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
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link href="/css/crt.css" rel="stylesheet">
</head>
<body>
<?php $activeRoute = 'change-password'; require __DIR__ . '/partials/nav.php'; ?>
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
