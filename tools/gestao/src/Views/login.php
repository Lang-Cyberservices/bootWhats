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
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link href="/css/crt.css" rel="stylesheet">
    <style>
        .brand {
            font-family: 'Press Start 2P', monospace;
            font-size: clamp(11px, 2.2vw, 14px);
            color: var(--amber) !important;
            text-shadow: 0 0 8px rgba(255, 176, 0, 0.4);
        }
        .login-hero {
            width: clamp(160px, 30vw, 220px);
            height: clamp(160px, 30vw, 220px);
            object-fit: cover;
            border-radius: 999px;
            border: 3px solid var(--green-dim);
            box-shadow: 0 0 30px var(--green-faint);
            filter: grayscale(1) sepia(1) hue-rotate(70deg) saturate(3) brightness(0.9);
        }
        .back-home {
            display: inline-block;
            margin-top: 20px;
            color: var(--green-dim);
            text-decoration: none;
        }
    </style>
</head>
<body>
<main class="container py-5">
    <div class="row justify-content-center">
        <div class="col-12 col-md-6 col-lg-5">
            <div class="text-center mb-4">
                <img class="login-hero mb-3" src="/img/diogenes.jpg" alt="Diogenes">
                <div class="brand text-uppercase">Gestao Diogenes</div>
                <h1 class="h3 mt-3">Bem-vindo</h1>
                <p class="text-secondary mb-0">> acesse sua conta de administracao_</p>
            </div>
            <div class="card shadow-sm border-0">
                <div class="card-body p-4">
                    <?php if ($error): ?>
                        <div class="alert alert-danger" role="alert">
                            <?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?>
                        </div>
                    <?php endif; ?>
                    <form method="post" action="/admin" class="vstack gap-3">
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
            <div class="text-center">
                <a class="back-home" href="/">[ &lt; voltar para a home ]</a>
            </div>
        </div>
    </div>
</main>
</body>
</html>
