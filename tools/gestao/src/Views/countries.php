<?php
/** @var array<int, array{id:int,name:string,sigla:string,description:?string,flag:?string,createdAt:string,updatedAt:string}> $countries */
/** @var array{id:int,name:string,sigla:string,description:?string,flag:?string,createdAt:string,updatedAt:string}|null $country */
/** @var string|null $error */
/** @var string|null $success */

function countryFlagEmoji(string $sigla): string
{
    $sigla = strtoupper(trim($sigla));
    if (strlen($sigla) !== 2 || !ctype_alpha($sigla)) {
        return '';
    }

    return mb_chr(127397 + ord($sigla[0])) . mb_chr(127397 + ord($sigla[1]));
}
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Paises - Gestao</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <link href="/css/crt.css" rel="stylesheet">
    <style>
        .description-box { white-space: pre-wrap; }
        .flag-emoji { font-size: 1.75rem; line-height: 1; }
        .flag-preview { height: 32px; display: block; border: 1px solid rgba(0,0,0,.1); }
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
            <a class="nav-link" href="/?route=welcome">Boas vindas</a>
            <a class="nav-link active" aria-current="page" href="/?route=countries">Paises</a>
            <a class="nav-link" href="/?route=system">Sistema</a>
            <a class="nav-link" href="/?route=change-password">Trocar senha</a>
            <a class="nav-link text-danger" href="/?route=logout">Sair</a>
        </div>
    </div>
</nav>
<main class="container py-5">
    <h1 class="h3 mb-3">Gestao de Paises</h1>
    <p class="text-secondary mb-4">Cadastre e edite os paises disponiveis.</p>

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
        <div class="col-12 col-xl-5">
            <div class="card border-0 shadow-sm">
                <div class="card-body p-4">
                    <div class="d-flex align-items-center justify-content-between mb-3">
                        <h2 class="h5 mb-0"><?= $country ? 'Editar pais' : 'Novo pais' ?></h2>
                        <?php if ($country): ?>
                            <a class="btn btn-sm btn-outline-secondary" href="/?route=countries">Novo</a>
                        <?php endif; ?>
                    </div>

                    <form method="post" action="/?route=countries" class="vstack gap-3">
                        <input type="hidden" name="action" value="<?= $country ? 'update' : 'create' ?>">
                        <?php if ($country): ?>
                            <input type="hidden" name="id" value="<?= (int) $country['id'] ?>">
                        <?php endif; ?>

                        <div>
                            <label class="form-label">Nome</label>
                            <input class="form-control" type="text" name="name" value="<?= htmlspecialchars((string) ($country['name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" required>
                        </div>

                        <div>
                            <label class="form-label">Sigla</label>
                            <input class="form-control" type="text" name="sigla" value="<?= htmlspecialchars((string) ($country['sigla'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" required>
                        </div>

                        <div>
                            <label class="form-label">Bandeira</label>
                            <input class="form-control" type="text" name="flag" value="<?= htmlspecialchars((string) ($country['flag'] ?? ''), ENT_QUOTES, 'UTF-8') ?>">
                        </div>

                        <div>
                            <label class="form-label">Descricao</label>
                            <textarea class="form-control" name="description" rows="4"><?= htmlspecialchars((string) ($country['description'] ?? ''), ENT_QUOTES, 'UTF-8') ?></textarea>
                        </div>

                        <button class="btn btn-primary" type="submit"><?= $country ? 'Salvar alteracoes' : 'Cadastrar pais' ?></button>
                    </form>
                </div>
            </div>
        </div>

        <div class="col-12 col-xl-7">
            <div class="d-flex align-items-center justify-content-between mb-3">
                <h2 class="h5 mb-0">Paises cadastrados</h2>
                <span class="badge text-bg-primary"><?= count($countries) ?></span>
            </div>

            <?php if (!$countries): ?>
                <div class="card border-0 shadow-sm">
                    <div class="card-body">
                        <p class="mb-0 text-secondary">Nenhum pais cadastrado.</p>
                    </div>
                </div>
            <?php else: ?>
                <div class="list-group shadow-sm">
                    <?php foreach ($countries as $item): ?>
                        <div class="list-group-item">
                            <div class="d-flex flex-wrap gap-3 align-items-start justify-content-between">
                                <div>
                                    <div class="fw-semibold text-primary">
                                        <?= htmlspecialchars($item['name'], ENT_QUOTES, 'UTF-8') ?>
                                        <span class="badge text-bg-secondary ms-1"><?= htmlspecialchars($item['sigla'], ENT_QUOTES, 'UTF-8') ?></span>
                                    </div>
                                </div>
                                <div class="text-center">
                                    <?php $emoji = countryFlagEmoji($item['sigla']); ?>
                                    <?php if ($emoji !== ''): ?>
                                        <div class="flag-emoji" title="Emoji a partir da sigla"><?= $emoji ?></div>
                                    <?php endif; ?>
                                    <?php if ($item['flag']): ?>
                                        <img class="flag-preview mt-1" src="<?= htmlspecialchars($item['flag'], ENT_QUOTES, 'UTF-8') ?>" alt="Bandeira de <?= htmlspecialchars($item['sigla'], ENT_QUOTES, 'UTF-8') ?>" title="Imagem a partir da URL cadastrada">
                                    <?php endif; ?>
                                </div>
                            </div>
                            <?php if ($item['description']): ?>
                                <div class="description-box small text-secondary mt-2"><?= htmlspecialchars($item['description'], ENT_QUOTES, 'UTF-8') ?></div>
                            <?php endif; ?>
                            <div class="d-flex gap-2 mt-3">
                                <a class="btn btn-sm btn-outline-primary" href="/?route=countries&id=<?= (int) $item['id'] ?>">Editar</a>
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
