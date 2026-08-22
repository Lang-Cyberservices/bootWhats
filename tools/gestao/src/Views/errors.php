<?php
/** @var array<int, array{id:int,process:string,context:string,message:string,stack:?string,resolved:int,resolvedAt:?string,createdAt:string}> $errors */
/** @var bool $showAll */
/** @var int $page */
/** @var int $totalPages */
/** @var int $unresolvedCount */
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Erros - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link href="/css/crt.css" rel="stylesheet">
    <style>
        .error-message { white-space: pre-line; }
        .error-stack { white-space: pre-wrap; font-size: 0.8rem; }
    </style>
</head>
<body>
<?php $activeRoute = 'errors'; require __DIR__ . '/partials/nav.php'; ?>
<main class="container py-5">
    <div class="d-flex align-items-center justify-content-between mb-3">
        <div>
            <h1 class="h3 mb-1">Log de erros</h1>
            <p class="text-secondary mb-0">Erros persistidos do bot e do worker de análise.</p>
        </div>
        <span class="badge text-bg-danger"><?= (int) $unresolvedCount ?> pendente<?= $unresolvedCount === 1 ? '' : 's' ?></span>
    </div>

    <div class="mb-3">
        <?php if ($showAll): ?>
            <a class="btn btn-sm btn-outline-secondary" href="/?route=errors">Só pendentes</a>
        <?php else: ?>
            <a class="btn btn-sm btn-outline-secondary" href="/?route=errors&all=1">Ver todos</a>
        <?php endif; ?>
    </div>

    <?php if (!$errors): ?>
        <div class="card border-0 shadow-sm">
            <div class="card-body">
                <p class="mb-0 text-secondary">
                    <?= $showAll ? 'Nenhum erro registrado.' : 'Nenhum erro pendente. 🎉' ?>
                </p>
            </div>
        </div>
    <?php else: ?>
        <div class="table-responsive">
            <table class="table align-middle table-hover bg-white shadow-sm">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Processo</th>
                        <th>Contexto</th>
                        <th>Mensagem</th>
                        <th>Quando</th>
                        <th>Status</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($errors as $error): ?>
                        <tr>
                            <td>#<?= (int) $error['id'] ?></td>
                            <td><span class="badge text-bg-secondary"><?= htmlspecialchars($error['process'], ENT_QUOTES, 'UTF-8') ?></span></td>
                            <td><?= htmlspecialchars($error['context'], ENT_QUOTES, 'UTF-8') ?></td>
                            <td>
                                <div class="error-message"><?= htmlspecialchars($error['message'], ENT_QUOTES, 'UTF-8') ?></div>
                                <?php if (!empty($error['stack'])): ?>
                                    <details>
                                        <summary class="text-secondary">stack trace</summary>
                                        <pre class="error-stack mb-0"><?= htmlspecialchars($error['stack'], ENT_QUOTES, 'UTF-8') ?></pre>
                                    </details>
                                <?php endif; ?>
                            </td>
                            <td class="text-nowrap"><?= htmlspecialchars($error['createdAt'], ENT_QUOTES, 'UTF-8') ?></td>
                            <td>
                                <?php if ((int) $error['resolved'] === 1): ?>
                                    <span class="badge text-bg-success">Resolvido</span>
                                <?php else: ?>
                                    <span class="badge text-bg-warning">Pendente</span>
                                <?php endif; ?>
                            </td>
                            <td>
                                <?php if ((int) $error['resolved'] !== 1): ?>
                                    <form method="post" action="/?route=errors">
                                        <input type="hidden" name="action" value="resolve">
                                        <input type="hidden" name="id" value="<?= (int) $error['id'] ?>">
                                        <?php if ($showAll): ?>
                                            <input type="hidden" name="all" value="1">
                                        <?php endif; ?>
                                        <button class="btn btn-sm btn-outline-success" type="submit">Resolver</button>
                                    </form>
                                <?php endif; ?>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <?php if ($totalPages > 1): ?>
            <nav aria-label="Paginação">
                <ul class="pagination">
                    <?php for ($p = 1; $p <= $totalPages; $p++): ?>
                        <li class="page-item<?= $p === $page ? ' active' : '' ?>">
                            <a class="page-link" href="/?route=errors<?= $showAll ? '&all=1' : '' ?>&page=<?= $p ?>"><?= $p ?></a>
                        </li>
                    <?php endfor; ?>
                </ul>
            </nav>
        <?php endif; ?>
    <?php endif; ?>
</main>
</body>
</html>
