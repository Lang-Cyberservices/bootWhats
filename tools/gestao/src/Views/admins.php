<?php
/** @var string|null $error */
/** @var string|null $success */
/** @var array<int, array{phone:string,authorId:string,expire_password:int}> $admins */
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Admins - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link href="/css/crt.css" rel="stylesheet">
</head>
<body>
<?php $activeRoute = 'admins'; require __DIR__ . '/partials/nav.php'; ?>
<main class="container py-5">
    <div class="row g-4">
        <div class="col-12 col-lg-5">
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
                        <input type="hidden" name="action" value="create">
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
        <div class="col-12 col-lg-7">
            <div class="d-flex align-items-center justify-content-between mb-3">
                <h2 class="h5 mb-0">Administradores</h2>
                <span class="badge text-bg-primary"><?= count($admins) ?></span>
            </div>
            <?php if (!$admins): ?>
                <div class="card border-0 shadow-sm">
                    <div class="card-body">
                        <p class="mb-0 text-secondary">Nenhum administrador cadastrado.</p>
                    </div>
                </div>
            <?php else: ?>
                <div class="list-group shadow-sm">
                    <?php foreach ($admins as $admin): ?>
                        <?php $isActive = (int) $admin['expire_password'] === 0; ?>
                        <div class="list-group-item">
                            <div class="d-flex flex-wrap gap-3 align-items-start justify-content-between">
                                <div>
                                    <div class="fw-semibold text-primary"><?= htmlspecialchars($admin['phone'], ENT_QUOTES, 'UTF-8') ?></div>
                                    <div class="text-secondary small">Author ID: <?= htmlspecialchars($admin['authorId'], ENT_QUOTES, 'UTF-8') ?></div>
                                </div>
                                <span class="badge <?= $isActive ? 'text-bg-success' : 'text-bg-warning' ?>">
                                    <?= $isActive ? 'Ativo' : 'Senha expirada' ?>
                                </span>
                            </div>
                            <div class="mt-3 d-flex flex-column gap-2">
                                <form method="post" action="/?route=admins" class="d-flex gap-2">
                                    <input type="hidden" name="action" value="reset">
                                    <input type="hidden" name="phone" value="<?= htmlspecialchars($admin['phone'], ENT_QUOTES, 'UTF-8') ?>">
                                    
                                    <input style="max-width: 200px;" class="form-control form-control-sm" type="password" name="password" placeholder="Nova senha" required>
                                    <button class="btn btn-sm btn-outline-primary" type="submit">Resetar senha</button>
                                </form>

                                <form method="post" action="/?route=admins">
                                    <input type="hidden" name="action" value="delete">
                                    <input type="hidden" name="phone" value="<?= htmlspecialchars($admin['phone'], ENT_QUOTES, 'UTF-8') ?>">
                                    <button class="btn btn-sm btn-outline-danger" type="submit">Excluir</button>
                                </form>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>
</main>
</body>
</html>
