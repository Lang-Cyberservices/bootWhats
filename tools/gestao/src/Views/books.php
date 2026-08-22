<?php
/** @var array<int, array{id:int,font:string,link:string,active:int,createdAt:string,updatedAt:string}> $downloads */
/** @var array{id:int,font:string,link:string,active:int}|null $download */
/** @var array<int, array{id:int,book:string,autoctor:string,description:string,createdAt:string,updatedAt:string}> $recommendations */
/** @var array{id:int,book:string,autoctor:string,description:string,createdAt:string,updatedAt:string}|null $latestRecommendation */
/** @var array{id:int,book:string,autoctor:string,description:string,createdAt:string,updatedAt:string}|null $editableRecommendation */
/** @var string|null $error */
/** @var string|null $success */
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Livros - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link href="/css/crt.css" rel="stylesheet">
    <style>
        .description-box { white-space: pre-wrap; }
        .mono { word-break: break-all; }
    </style>
</head>
<body>
<?php $activeRoute = 'books'; require __DIR__ . '/partials/nav.php'; ?>
<main class="container py-5">
    <h1 class="h3 mb-3">Gestao de Livros</h1>
    <p class="text-secondary mb-4">Gerencie os links de download usados no comando e a recomendacao atual do Dio. Recomendacoes antigas ficam visiveis apenas para consulta.</p>

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

    <div class="row g-4">
        <div class="col-12 col-xl-6">
            <div class="card border-0 shadow-sm">
                <div class="card-body p-4">
                    <div class="d-flex align-items-center justify-content-between mb-3">
                        <h2 class="h5 mb-0"><?= $download ? 'Editar download' : 'Novo download' ?></h2>
                        <?php if ($download): ?>
                            <a class="btn btn-sm btn-outline-secondary" href="/?route=books">Novo</a>
                        <?php endif; ?>
                    </div>

                    <form method="post" action="/?route=books" class="vstack gap-3">
                        <input type="hidden" name="section" value="download">
                        <input type="hidden" name="action" value="<?= $download ? 'update' : 'create' ?>">
                        <?php if ($download): ?>
                            <input type="hidden" name="id" value="<?= (int) $download['id'] ?>">
                        <?php endif; ?>

                        <div>
                            <label class="form-label">Fonte</label>
                            <input class="form-control" type="text" name="font" value="<?= htmlspecialchars((string) ($download['font'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" required>
                        </div>

                        <div>
                            <label class="form-label">Link</label>
                            <input class="form-control mono" type="url" name="link" value="<?= htmlspecialchars((string) ($download['link'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" required>
                        </div>

                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" id="download-active" name="active" value="1" <?= (($download['active'] ?? 1) === 1) ? 'checked' : '' ?>>
                            <label class="form-check-label" for="download-active">Ativo</label>
                        </div>

                        <button class="btn btn-primary" type="submit"><?= $download ? 'Salvar alteracoes' : 'Cadastrar link' ?></button>
                    </form>
                </div>
            </div>

            <div class="d-flex align-items-center justify-content-between mt-4 mb-3">
                <h2 class="h5 mb-0">Links cadastrados</h2>
                <span class="badge text-bg-primary"><?= count($downloads) ?></span>
            </div>

            <?php if (!$downloads): ?>
                <div class="card border-0 shadow-sm">
                    <div class="card-body">
                        <p class="mb-0 text-secondary">Nenhum link de download cadastrado.</p>
                    </div>
                </div>
            <?php else: ?>
                <div class="list-group shadow-sm">
                    <?php foreach ($downloads as $item): ?>
                        <div class="list-group-item">
                            <div class="d-flex flex-wrap gap-3 align-items-start justify-content-between">
                                <div>
                                    <div class="fw-semibold text-primary"><?= htmlspecialchars($item['font'], ENT_QUOTES, 'UTF-8') ?></div>
                                    <div class="small mono text-secondary"><?= htmlspecialchars($item['link'], ENT_QUOTES, 'UTF-8') ?></div>
                                </div>
                                <span class="badge <?= ((int) $item['active']) === 1 ? 'text-bg-success' : 'text-bg-secondary' ?>">
                                    <?= ((int) $item['active']) === 1 ? 'Ativo' : 'Inativo' ?>
                                </span>
                            </div>
                            <div class="small text-secondary mt-2">
                                Atualizado em <?= htmlspecialchars((string) $item['updatedAt'], ENT_QUOTES, 'UTF-8') ?>
                            </div>
                            <div class="d-flex gap-2 mt-3">
                                <a class="btn btn-sm btn-outline-primary" href="/?route=books&downloadId=<?= (int) $item['id'] ?>">Editar</a>
                                <?php if ((int) $item['active'] === 1): ?>
                                    <form method="post" action="/?route=books">
                                        <input type="hidden" name="section" value="download">
                                        <input type="hidden" name="action" value="deactivate">
                                        <input type="hidden" name="id" value="<?= (int) $item['id'] ?>">
                                        <button class="btn btn-sm btn-outline-danger" type="submit">Inativar</button>
                                    </form>
                                <?php endif; ?>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>

        <div class="col-12 col-xl-6">
            <div class="card border-0 shadow-sm mb-4">
                <div class="card-body p-4">
                    <div class="d-flex align-items-center justify-content-between mb-3">
                        <h2 class="h5 mb-0"><?= $editableRecommendation ? 'Editar recomendacao atual' : 'Nova recomendacao' ?></h2>
                        <?php if ($latestRecommendation): ?>
                            <div class="d-flex gap-2 align-items-center">
                                <span class="badge text-bg-primary">Atual #<?= (int) $latestRecommendation['id'] ?></span>
                                <?php if ($editableRecommendation): ?>
                                    <a class="btn btn-sm btn-outline-secondary" href="/?route=books&recommendationMode=create">Nova</a>
                                <?php endif; ?>
                            </div>
                        <?php endif; ?>
                    </div>

                    <form method="post" action="/?route=books" class="vstack gap-3">
                        <input type="hidden" name="section" value="recommendation">
                        <input type="hidden" name="action" value="<?= $editableRecommendation ? 'update' : 'create' ?>">
                        <?php if ($editableRecommendation): ?>
                            <input type="hidden" name="id" value="<?= (int) $editableRecommendation['id'] ?>">
                        <?php endif; ?>

                        <div>
                            <label class="form-label">Livro</label>
                            <input class="form-control" type="text" name="book" value="<?= htmlspecialchars((string) ($editableRecommendation['book'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" required>
                        </div>

                        <div>
                            <label class="form-label">Autor</label>
                            <input class="form-control" type="text" name="autoctor" value="<?= htmlspecialchars((string) ($editableRecommendation['autoctor'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" required>
                        </div>

                        <div>
                            <label class="form-label">Descricao</label>
                            <textarea class="form-control" name="description" rows="5" required><?= htmlspecialchars((string) ($editableRecommendation['description'] ?? ''), ENT_QUOTES, 'UTF-8') ?></textarea>
                        </div>
                        <button class="btn btn-primary" type="submit"><?= $editableRecommendation ? 'Salvar recomendacao' : 'Cadastrar recomendacao' ?></button>
                    </form>

                    <?php if ($latestRecommendation): ?>
                        <div class="form-text mt-3">Apenas a recomendacao mais recente pode ser editada. Para trocar a sugestao exibida no bot, edite a atual ou cadastre uma nova.</div>
                    <?php endif; ?>
                </div>
            </div>

            <div class="card border-0 shadow-sm">
                <div class="card-body p-4">
                    <div class="d-flex align-items-center justify-content-between mb-3">
                        <h2 class="h5 mb-0">Historico de recomendacoes</h2>
                        <span class="badge text-bg-primary"><?= count($recommendations) ?></span>
                    </div>

                    <?php if (!$recommendations): ?>
                        <p class="mb-0 text-secondary">Nenhuma recomendacao cadastrada.</p>
                    <?php else: ?>
                        <div class="list-group">
                            <?php foreach ($recommendations as $item): ?>
                                <?php $isLatest = $latestRecommendation !== null && (int) $item['id'] === (int) $latestRecommendation['id']; ?>
                                <div class="list-group-item">
                                    <div class="d-flex flex-wrap gap-3 justify-content-between align-items-start">
                                        <div>
                                            <div class="fw-semibold text-primary"><?= htmlspecialchars($item['book'], ENT_QUOTES, 'UTF-8') ?></div>
                                            <div class="text-secondary small"><?= htmlspecialchars($item['autoctor'], ENT_QUOTES, 'UTF-8') ?></div>
                                        </div>
                                        <span class="badge <?= $isLatest ? 'text-bg-success' : 'text-bg-secondary' ?>">
                                            <?= $isLatest ? 'Atual' : 'Historico' ?>
                                        </span>
                                    </div>
                                    <div class="description-box mt-3"><?= htmlspecialchars($item['description'], ENT_QUOTES, 'UTF-8') ?></div>
                                    <div class="small text-secondary mt-3">
                                        Criado em <?= htmlspecialchars((string) $item['createdAt'], ENT_QUOTES, 'UTF-8') ?>
                                    </div>
                                    <?php if ($isLatest): ?>
                                        <div class="mt-3">
                                            <a class="btn btn-sm btn-outline-primary" href="/?route=books&recommendationId=<?= (int) $item['id'] ?>">Editar atual</a>
                                        </div>
                                    <?php endif; ?>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </div>
        </div>
    </div>
</main>
</body>
</html>
