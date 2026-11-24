<?php
/** @var array<int, array{id:int,text:string,active:int,createdAt:string}> $questions */
/** @var int $activeCount */
/** @var int $minActive */
/** @var array{total:int,lastDay:int} $guessSummary */
/** @var string|null $error */
/** @var string|null $success */
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Sua idade - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link href="/css/crt.css" rel="stylesheet">
    <style>
        .question-inactive .form-control { opacity: 0.5; }
    </style>
</head>
<body>
<?php $activeRoute = 'age-questions'; require __DIR__ . '/partials/nav.php'; ?>
<main class="container py-5">
    <div class="row g-4">
        <div class="col-12 col-lg-5">
            <h1 class="h3 mb-3">Perguntas do /sua-idade</h1>
            <p class="text-secondary">
                Cada visita a <a href="/sua-idade" target="_blank">/sua-idade</a> sorteia 5 perguntas ativas
                (mais 2 reservas para o botão "trocar pergunta").
            </p>
            <p class="text-secondary">
                Idades calculadas: <?= $guessSummary['total'] ?> no total, <?= $guessSummary['lastDay'] ?> nas últimas 24h.
            </p>
            <?php if ($activeCount < $minActive): ?>
                <div class="alert alert-danger" role="alert">
                    Só <?= $activeCount ?> pergunta(s) ativa(s). A página precisa de pelo menos <?= $minActive ?> e está em manutenção.
                </div>
            <?php endif; ?>
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
            <div class="card border-0 shadow-sm">
                <div class="card-body p-4">
                    <h2 class="h5 mb-3">Adicionar</h2>
                    <form method="post" action="/?route=age-questions" class="vstack gap-3">
                        <input type="hidden" name="action" value="create">
                        <input class="form-control" type="text" name="text" maxlength="255" placeholder="Ex.: Um desenho que passava de manhã na TV" required>
                        <button class="btn btn-primary" type="submit">Salvar</button>
                    </form>
                </div>
            </div>
        </div>
        <div class="col-12 col-lg-7">
            <div class="d-flex align-items-center justify-content-between mb-3">
                <h2 class="h5 mb-0">Lista</h2>
                <span class="badge text-bg-primary"><?= $activeCount ?> ativa(s) de <?= count($questions) ?></span>
            </div>
            <?php if (!$questions): ?>
                <div class="card border-0 shadow-sm">
                    <div class="card-body">
                        <p class="mb-0 text-secondary">Nenhuma pergunta cadastrada.</p>
                    </div>
                </div>
            <?php else: ?>
                <div class="list-group shadow-sm">
                    <?php foreach ($questions as $question): ?>
                        <?php $isActive = (int) $question['active'] === 1; ?>
                        <div class="list-group-item<?= $isActive ? '' : ' question-inactive' ?>">
                            <form method="post" action="/?route=age-questions" class="d-flex gap-2 align-items-center mb-2">
                                <span class="fw-semibold text-primary">#<?= (int) $question['id'] ?></span>
                                <input type="hidden" name="action" value="update">
                                <input type="hidden" name="id" value="<?= (int) $question['id'] ?>">
                                <input class="form-control form-control-sm" type="text" name="text" maxlength="255" required
                                       value="<?= htmlspecialchars($question['text'], ENT_QUOTES, 'UTF-8') ?>">
                                <button class="btn btn-sm btn-outline-primary" type="submit">Salvar</button>
                            </form>
                            <div class="d-flex gap-2 justify-content-end">
                                <form method="post" action="/?route=age-questions">
                                    <input type="hidden" name="action" value="toggle">
                                    <input type="hidden" name="id" value="<?= (int) $question['id'] ?>">
                                    <input type="hidden" name="active" value="<?= $isActive ? '0' : '1' ?>">
                                    <button class="btn btn-sm <?= $isActive ? 'btn-outline-secondary' : 'btn-outline-primary' ?>" type="submit"><?= $isActive ? 'Desativar' : 'Ativar' ?></button>
                                </form>
                                <form method="post" action="/?route=age-questions" onsubmit="return confirm('Remover a pergunta #<?= (int) $question['id'] ?>?');">
                                    <input type="hidden" name="action" value="delete">
                                    <input type="hidden" name="id" value="<?= (int) $question['id'] ?>">
                                    <button class="btn btn-sm btn-outline-danger" type="submit">Remover</button>
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
