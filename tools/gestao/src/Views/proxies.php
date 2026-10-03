<?php
/** @var array<int, array{id:int,url:string,port:int,active:int,success:int,fails:int,lastUsedAt:?string,createdAt:string}> $proxies */
/** @var array{total:int,active:int,inactive:int,untested:int} $summary */
/** @var string $filter */
/** @var int $page */
/** @var int $totalPages */
/** @var ?string $error */
/** @var ?string $success */
/** @var array<int, string> $invalidLines */
/** @var int $invalidHidden */

$selfUrl = '/?route=proxies&filter=' . $filter . '&page=' . $page;
$filterLabels = ['all' => 'Todos', 'active' => 'Ativos', 'inactive' => 'Inativos'];
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Proxies - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link href="/css/crt.css" rel="stylesheet">
</head>
<body>
<?php $activeRoute = 'proxies'; require __DIR__ . '/partials/nav.php'; ?>
<main class="container py-5">
    <div class="d-flex align-items-center justify-content-between mb-3">
        <div>
            <h1 class="h3 mb-1">Proxies</h1>
            <p class="text-secondary mb-0">Pool usado pelo yt-dlp em /video e /musica, na ordem em que o bot escolhe.</p>
        </div>
        <div>
            <span class="badge text-bg-success"><?= $summary['active'] ?> ativos</span>
            <span class="badge text-bg-secondary"><?= $summary['inactive'] ?> inativos</span>
            <span class="badge text-bg-warning"><?= $summary['untested'] ?> nunca testados</span>
        </div>
    </div>

    <?php if ($error): ?>
        <div class="alert alert-danger"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>
    <?php if ($success): ?>
        <div class="alert alert-success"><?= htmlspecialchars($success, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>
    <?php if ($invalidLines): ?>
        <div class="alert alert-warning">
            <div>Linhas ignoradas por não seguirem <code>esquema://host:porta</code>:</div>
            <pre class="mb-0"><?= htmlspecialchars(implode("\n", $invalidLines), ENT_QUOTES, 'UTF-8') ?></pre>
            <?php if ($invalidHidden > 0): ?>
                <div>… e mais <?= $invalidHidden ?>.</div>
            <?php endif; ?>
        </div>
    <?php endif; ?>

    <div class="card border-0 shadow-sm mb-4">
        <div class="card-body">
            <h2 class="h5">Importar lista</h2>
            <p class="text-secondary">Um proxy por linha: <code>http://57.128.44.204:3128</code> ou <code>socks5://45.74.31.42:16599</code>. Os já cadastrados são ignorados.</p>
            <form method="post" action="<?= htmlspecialchars($selfUrl, ENT_QUOTES, 'UTF-8') ?>">
                <input type="hidden" name="action" value="import">
                <textarea class="form-control mb-3" name="list" rows="8" placeholder="http://host:porta" required></textarea>
                <button class="btn btn-primary" type="submit">Importar</button>
            </form>
        </div>
    </div>

    <div class="mb-3">
        <?php foreach ($filterLabels as $key => $label): ?>
            <a class="btn btn-sm <?= $filter === $key ? 'btn-secondary' : 'btn-outline-secondary' ?>" href="/?route=proxies&filter=<?= $key ?>"><?= $label ?></a>
        <?php endforeach; ?>
    </div>

    <?php if (!$proxies): ?>
        <div class="card border-0 shadow-sm">
            <div class="card-body">
                <p class="mb-0 text-secondary">Nenhum proxy por aqui.</p>
            </div>
        </div>
    <?php else: ?>
        <div class="table-responsive">
            <table class="table align-middle table-hover bg-white shadow-sm">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Proxy</th>
                        <th>Sucessos</th>
                        <th>Falhas</th>
                        <th>Saldo</th>
                        <th>Último uso</th>
                        <th>Status</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($proxies as $proxy): ?>
                        <?php $isActive = (int) $proxy['active'] === 1; ?>
                        <tr>
                            <td>#<?= (int) $proxy['id'] ?></td>
                            <td><?= htmlspecialchars($proxy['url'] . ':' . $proxy['port'], ENT_QUOTES, 'UTF-8') ?></td>
                            <td><?= (int) $proxy['success'] ?></td>
                            <td><?= (int) $proxy['fails'] ?></td>
                            <td><?= (int) $proxy['success'] - (int) $proxy['fails'] ?></td>
                            <td class="text-nowrap"><?= htmlspecialchars((string) ($proxy['lastUsedAt'] ?? '—'), ENT_QUOTES, 'UTF-8') ?></td>
                            <td>
                                <?php if ($isActive): ?>
                                    <span class="badge text-bg-success">Ativo</span>
                                <?php else: ?>
                                    <span class="badge text-bg-secondary">Inativo</span>
                                <?php endif; ?>
                            </td>
                            <td class="text-nowrap">
                                <form class="d-inline" method="post" action="<?= htmlspecialchars($selfUrl, ENT_QUOTES, 'UTF-8') ?>">
                                    <input type="hidden" name="action" value="toggle">
                                    <input type="hidden" name="id" value="<?= (int) $proxy['id'] ?>">
                                    <input type="hidden" name="active" value="<?= $isActive ? '0' : '1' ?>">
                                    <button class="btn btn-sm <?= $isActive ? 'btn-outline-danger' : 'btn-outline-success' ?>" type="submit"><?= $isActive ? 'Desativar' : 'Ativar' ?></button>
                                </form>
                                <form class="d-inline" method="post" action="<?= htmlspecialchars($selfUrl, ENT_QUOTES, 'UTF-8') ?>">
                                    <input type="hidden" name="action" value="reset">
                                    <input type="hidden" name="id" value="<?= (int) $proxy['id'] ?>">
                                    <button class="btn btn-sm btn-outline-secondary" type="submit" title="Zera sucessos e falhas e reativa">Zerar</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <?php if ($totalPages > 1): ?>
            <nav aria-label="Paginação">
                <ul class="pagination flex-wrap">
                    <?php for ($p = 1; $p <= $totalPages; $p++): ?>
                        <li class="page-item<?= $p === $page ? ' active' : '' ?>">
                            <a class="page-link" href="/?route=proxies&filter=<?= $filter ?>&page=<?= $p ?>"><?= $p ?></a>
                        </li>
                    <?php endfor; ?>
                </ul>
            </nav>
        <?php endif; ?>
    <?php endif; ?>
</main>
</body>
</html>
