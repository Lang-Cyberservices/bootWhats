<?php
/** @var array<int, array{chatId:string,peopleToTrigger:int,counter:int,enabled:int,updatedAt:string}> $configs */
/** @var array{chatId:string,message:string,peopleToTrigger:int,counter:int,enabled:int}|null $config */
/** @var string|null $error */
/** @var string|null $success */
$selectedChatId = $config['chatId'] ?? (string) ($_GET['chatId'] ?? '');
$selectedChatId = trim($selectedChatId);
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Boas vindas - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link href="/css/crt.css" rel="stylesheet">
    <style>
        textarea { white-space: pre-wrap; }
        .mono { word-break: break-all; }
    </style>
</head>
<body>
<nav class="navbar navbar-expand-lg bg-white border-bottom shadow-sm">
    <div class="container">
        <a class="navbar-brand" href="/">Diogenes</a>
        <div class="navbar-nav">
            <a class="nav-link" href="/?route=jokes">Piadas</a>
            <a class="nav-link" href="/?route=admins">Admins</a>
            <a class="nav-link" href="/?route=books">Livros</a>
            <a class="nav-link active" aria-current="page" href="/?route=welcome">Boas vindas</a>
            <a class="nav-link" href="/?route=countries">Paises</a>
            <a class="nav-link" href="/?route=system">Sistema</a>
            <a class="nav-link" href="/?route=change-password">Trocar senha</a>
            <a class="nav-link text-danger" href="/?route=logout">Sair</a>
        </div>
    </div>
</nav>
<main class="container py-5">
    <div class="row g-4">
        <div class="col-12 col-lg-6">
            <h1 class="h3 mb-3">Boas vindas</h1>
            <p class="text-secondary">Configure a mensagem e o numero de novos membros para disparo. O contador atual e exibido e o bot controla o incremento/reset.</p>

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
                    <form method="post" action="/?route=welcome" class="vstack gap-3">
                        <div>
                            <label class="form-label">Chat ID do grupo</label>
                            <input class="form-control mono" type="text" name="chatId" value="<?= htmlspecialchars($selectedChatId, ENT_QUOTES, 'UTF-8') ?>" placeholder="Ex: 1203...@g.us" required>
                            <div class="form-text">Use o ID serializado do WhatsApp (termina com <span class="mono">@g.us</span>).</div>
                        </div>

                        <div class="row g-3">
                            <div class="col-12 col-md-6">
                                <label class="form-label">Visitantes para disparar</label>
                                <input class="form-control" type="number" min="1" step="1" name="peopleToTrigger"
                                       value="<?= htmlspecialchars((string) (($config['peopleToTrigger'] ?? 1)), ENT_QUOTES, 'UTF-8') ?>" required>
                            </div>
                            <div class="col-12 col-md-6">
                                <label class="form-label">Contador atual</label>
                                <input class="form-control" disabled type="number" value="<?= htmlspecialchars((string) (($config['counter'] ?? 0)), ENT_QUOTES, 'UTF-8') ?>" readonly>
                            </div>
                        </div>

                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" id="enabled" name="enabled" value="1" <?= (($config['enabled'] ?? 1) === 1) ? 'checked' : '' ?>>
                            <label class="form-check-label" for="enabled">Ativo</label>
                        </div>

                        <div>
                            <label class="form-label">Mensagem</label>
                            <textarea class="form-control" name="message" rows="5" required><?= htmlspecialchars((string) (($config['message'] ?? '')), ENT_QUOTES, 'UTF-8') ?></textarea>
                        </div>

                        <button class="btn btn-primary" type="submit">Salvar</button>
                    </form>
                </div>
            </div>
        </div>

        <div class="col-12 col-lg-6">
            <div class="d-flex align-items-center justify-content-between mb-3">
                <h2 class="h5 mb-0">Configs</h2>
                <span class="badge text-bg-primary"><?= count($configs) ?></span>
            </div>

            <?php if (!$configs): ?>
                <div class="card border-0 shadow-sm">
                    <div class="card-body">
                        <p class="mb-0 text-secondary">Nenhuma configuracao cadastrada.</p>
                    </div>
                </div>
            <?php else: ?>
                <div class="list-group shadow-sm">
                    <?php foreach ($configs as $row): ?>
                        <a class="list-group-item list-group-item-action d-flex align-items-start gap-3"
                           href="/?route=welcome&chatId=<?= urlencode($row['chatId']) ?>">
                            <div class="mono text-primary"><?= htmlspecialchars($row['chatId'], ENT_QUOTES, 'UTF-8') ?></div>
                            <div class="ms-auto text-end">
                                <div class="small text-secondary">x: <strong><?= (int) $row['peopleToTrigger'] ?></strong></div>
                                <div class="small text-secondary">contador: <strong><?= (int) $row['counter'] ?></strong></div>
                                <div class="small <?= ((int) $row['enabled']) === 1 ? 'text-success' : 'text-muted' ?>">
                                    <?= ((int) $row['enabled']) === 1 ? 'ativo' : 'inativo' ?>
                                </div>
                            </div>
                        </a>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>
</main>
</body>
</html>
