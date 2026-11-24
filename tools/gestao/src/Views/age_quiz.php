<?php
/** @var array<int, array{id:int,text:string}> $questions */
/** @var bool $unavailable */
/** @var int $questionsPerGame */
/** @var int $maxAnswerLength */
/** @var string $pageUrl */

$quizData = [
    'questions' => array_map(static fn (array $q): array => ['id' => (int) $q['id'], 'text' => (string) $q['text']], $questions),
    'perGame' => $questionsPerGame,
    'pageUrl' => $pageUrl,
];
?>
<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Sua idade — Diogenes</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Responda 5 perguntas sobre a sua infância e o Diogenes adivinha a sua idade.">
    <meta property="og:title" content="Quantos anos você tem? O Diogenes adivinha.">
    <meta property="og:description" content="Responda 5 perguntas sobre a sua infância e descubra.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #050805;
            --panel: #0a120a;
            --input-bg: #061006;
            --green: #33ff66;
            --green-dim: #1fa348;
            --green-faint: rgba(51, 255, 102, 0.18);
            --green-soft: #8fe6a8;
            --amber: #ffb000;
            --red: #ff5c5c;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            background: var(--bg);
            color: var(--green);
            font-family: 'VT323', monospace;
            font-size: clamp(19px, 2.4vw, 23px);
            line-height: 1.35;
            overflow-x: hidden;
            text-shadow: 0 0 6px rgba(51, 255, 102, 0.35);
            min-height: 100vh;
        }

        /* scanlines + vinheta de CRT */
        body::before {
            content: '';
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 10;
            background: repeating-linear-gradient(
                to bottom,
                rgba(0, 0, 0, 0) 0px,
                rgba(0, 0, 0, 0) 2px,
                rgba(0, 0, 0, 0.22) 3px,
                rgba(0, 0, 0, 0) 4px
            );
        }
        body::after {
            content: '';
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 11;
            background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%);
        }

        main {
            max-width: 760px;
            margin: 0 auto;
            padding: clamp(16px, 4vw, 48px) 16px;
        }

        a { color: var(--green); }
        a:hover { color: var(--bg); background: var(--green); text-shadow: none; }

        /* ── topo ─────────────────────────────── */
        .top {
            display: flex;
            align-items: center;
            gap: clamp(14px, 3vw, 24px);
            margin-bottom: clamp(20px, 4vw, 36px);
        }
        .top img {
            width: clamp(64px, 14vw, 96px);
            height: clamp(64px, 14vw, 96px);
            object-fit: cover;
            border-radius: 6px;
            border: 2px solid var(--green-dim);
            filter: grayscale(1) sepia(1) hue-rotate(70deg) saturate(3) brightness(0.9);
            flex-shrink: 0;
        }
        h1 {
            font-family: 'Press Start 2P', monospace;
            text-transform: uppercase;
            font-size: clamp(14px, 3.6vw, 24px);
            line-height: 1.5;
            margin-bottom: 8px;
        }
        .tagline { color: var(--green-soft); }

        /* ── terminal ─────────────────────────── */
        .terminal {
            border: 2px solid var(--green-dim);
            border-radius: 8px;
            background: var(--panel);
            padding: clamp(18px, 4vw, 34px);
            box-shadow: 0 0 24px var(--green-faint), inset 0 0 40px rgba(51, 255, 102, 0.05);
            min-height: 280px;
        }

        .progress {
            font-family: 'Press Start 2P', monospace;
            font-size: clamp(9px, 1.8vw, 11px);
            color: var(--amber);
            text-shadow: 0 0 8px rgba(255, 176, 0, 0.4);
            margin-bottom: 18px;
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        .progress .dots { letter-spacing: 4px; color: var(--green-dim); }
        .progress .dots b { color: var(--amber); font-weight: normal; }

        .question {
            font-size: clamp(22px, 3.2vw, 28px);
            min-height: 2.8em;
            margin-bottom: 16px;
            overflow-wrap: anywhere;
        }
        .question::before { content: '> '; color: var(--green-dim); }

        .cursor {
            display: inline-block;
            width: 0.55em;
            height: 1em;
            background: var(--green);
            vertical-align: text-bottom;
            animation: blink 1s steps(1) infinite;
        }
        @keyframes blink { 50% { opacity: 0; } }

        .answer-row {
            display: flex;
            align-items: center;
            gap: 8px;
            border: 1px solid var(--green-dim);
            border-radius: 6px;
            background: var(--input-bg);
            padding: 8px 12px;
        }
        .answer-row:focus-within { border-color: var(--green); box-shadow: 0 0 12px var(--green-faint); }
        .answer-row span { color: var(--green-dim); }
        .answer-row input {
            flex: 1;
            min-width: 0;
            background: none;
            border: none;
            outline: none;
            color: var(--green);
            font: inherit;
            text-shadow: inherit;
            caret-color: var(--green);
        }
        .answer-row input::placeholder { color: var(--green-dim); opacity: 0.7; }
        .shake { animation: shake 0.3s; }
        @keyframes shake {
            25% { transform: translateX(-6px); }
            75% { transform: translateX(6px); }
        }

        .counter { color: var(--green-dim); font-size: 0.8em; text-align: right; margin-top: 4px; }

        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 18px;
        }

        /* Press Start 2P não tem acentos: textos nessa fonte vão sem acento, como no painel. */
        .btn {
            font-family: 'Press Start 2P', monospace;
            font-size: clamp(9px, 1.8vw, 11px);
            text-transform: uppercase;
            line-height: 1.5;
            padding: 11px 14px;
            border-radius: 4px;
            border: 1px solid var(--green);
            background: none;
            color: var(--green);
            text-shadow: inherit;
            text-decoration: none;
            cursor: pointer;
            display: inline-block;
        }
        .btn:hover, .btn:focus-visible { background: var(--green); color: var(--bg); text-shadow: none; outline: none; }
        .btn-primary { background: var(--green); color: var(--bg); text-shadow: none; }
        .btn-primary:hover, .btn-primary:focus-visible { box-shadow: 0 0 16px var(--green-faint); }
        .btn-ghost { border-color: var(--green-dim); color: var(--green-soft); }
        .btn:disabled { opacity: 0.4; cursor: default; background: none; color: var(--green-dim); border-color: var(--green-dim); }

        /* ── estados ──────────────────────────── */
        [hidden] { display: none !important; }

        .loading { font-size: clamp(22px, 3.2vw, 28px); }
        .loading .dots::after {
            content: '';
            animation: dots 1.2s steps(4) infinite;
        }
        @keyframes dots {
            0% { content: ''; }
            25% { content: '.'; }
            50% { content: '..'; }
            75% { content: '...'; }
        }
        .loading .sub { color: var(--green-dim); font-size: 0.8em; margin-top: 10px; }

        .result .verdict {
            font-size: clamp(24px, 4vw, 34px);
            margin-bottom: 14px;
        }
        .result .age {
            font-family: 'Press Start 2P', monospace;
            font-size: clamp(30px, 8vw, 56px);
            color: var(--amber);
            text-shadow: 0 0 14px rgba(255, 176, 0, 0.5);
            display: inline-block;
            margin: 0 6px;
            vertical-align: middle;
        }
        .result .comment { color: var(--green-soft); margin-bottom: 18px; overflow-wrap: anywhere; }
        .result h2 {
            font-family: 'Press Start 2P', monospace;
            font-size: clamp(9px, 1.8vw, 11px);
            text-transform: uppercase;
            color: var(--amber);
            margin-bottom: 8px;
        }
        .result h2::before { content: '[ '; }
        .result h2::after { content: ' ]'; }
        .result ul { list-style: none; }
        .result li { color: var(--green-soft); padding-left: 1.1em; margin-bottom: 4px; overflow-wrap: anywhere; }
        .result li::before { content: '- '; color: var(--green-dim); margin-left: -1.1em; }

        .error { color: var(--red); text-shadow: 0 0 6px rgba(255, 92, 92, 0.35); }
        .error::before { content: '! '; }

        footer {
            text-align: center;
            color: var(--green-dim);
            margin-top: 28px;
        }
    </style>
</head>
<body>
<main>
    <header class="top">
        <img src="/img/diogenes.jpg" alt="Diogenes">
        <div>
            <h1>Quantos anos voce tem?</h1>
            <p class="tagline">Responda <?= $questionsPerGame ?> perguntas sobre a sua infância e o Diogenes adivinha.</p>
        </div>
    </header>

    <div class="terminal">
        <?php if ($unavailable): ?>
            <p class="question">O Diogenes está sem perguntas agora. Volte mais tarde<span class="cursor"></span></p>
        <?php else: ?>
            <noscript><p class="error">Esta brincadeira precisa de JavaScript ligado.</p></noscript>

            <form id="quiz" autocomplete="off" hidden>
                <div class="progress">
                    <span id="progress-label"></span>
                    <span class="dots" id="progress-dots"></span>
                </div>
                <p class="question"><span id="question-text"></span><span class="cursor"></span></p>
                <label class="answer-row" id="answer-row">
                    <span>$</span>
                    <input id="answer" type="text" maxlength="<?= $maxAnswerLength ?>" placeholder="sua resposta" aria-label="Sua resposta">
                </label>
                <p class="counter"><span id="counter">0</span>/<?= $maxAnswerLength ?></p>
                <div class="actions">
                    <button class="btn btn-primary" type="submit" id="next">Proxima &gt;</button>
                    <button class="btn btn-ghost" type="button" id="swap"></button>
                </div>
            </form>

            <div id="loading" class="loading" hidden>
                <p>&gt; calculando sua idade<span class="dots"></span></p>
                <p class="sub">consultando a memória do Diogenes (pode levar alguns segundos)</p>
            </div>

            <div id="result" class="result" hidden>
                <p class="verdict">Sua idade é <span class="age" id="result-age"></span> anos...</p>
                <p class="comment" id="result-comment"></p>
                <div id="result-clues-box">
                    <h2>O que te entregou</h2>
                    <ul id="result-clues"></ul>
                </div>
                <div class="actions">
                    <a class="btn btn-primary" id="share" href="#" target="_blank" rel="noopener">Compartilhar no WhatsApp</a>
                    <a class="btn btn-ghost" href="/sua-idade">Jogar de novo</a>
                </div>
            </div>

            <div id="failure" hidden>
                <p class="error" id="failure-text"></p>
                <div class="actions">
                    <button class="btn btn-primary" type="button" id="retry">Tentar de novo</button>
                    <a class="btn btn-ghost" href="/sua-idade">Recomecar</a>
                </div>
            </div>
        <?php endif; ?>
    </div>

    <footer>
        <a href="/">&lt; voltar para o Diogenes</a>
    </footer>
</main>

<?php if (!$unavailable): ?>
<script>
    (function () {
        var data = <?= json_encode($quizData, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
        var current = data.questions.slice(0, data.perGame);
        var spares = data.questions.slice(data.perGame);
        var answers = [];
        var index = 0;
        var typing = null;
        var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        var el = function (id) { return document.getElementById(id); };
        var quiz = el('quiz');
        var input = el('answer');

        function show(section) {
            ['quiz', 'loading', 'result', 'failure'].forEach(function (id) {
                el(id).hidden = id !== section;
            });
        }

        // Digita a pergunta como num terminal.
        function typeText(target, text) {
            clearInterval(typing);
            if (reduceMotion) {
                target.textContent = text;
                return;
            }
            var i = 0;
            target.textContent = '';
            typing = setInterval(function () {
                i += 1;
                target.textContent = text.slice(0, i);
                if (i >= text.length) clearInterval(typing);
            }, 28);
        }

        function renderQuestion() {
            el('progress-label').textContent = 'Pergunta ' + (index + 1) + '/' + data.perGame;
            var dots = '';
            for (var i = 0; i < data.perGame; i++) dots += i <= index ? '<b>■</b>' : '□';
            el('progress-dots').innerHTML = dots;
            typeText(el('question-text'), current[index].text);
            el('swap').textContent = 'Nao lembro, trocar (' + spares.length + ')';
            el('swap').disabled = spares.length === 0;
            el('next').textContent = index === data.perGame - 1 ? 'Calcular idade' : 'Proxima >';
            input.value = '';
            el('counter').textContent = '0';
            input.focus();
        }

        input.addEventListener('input', function () {
            el('counter').textContent = String(input.value.length);
        });

        el('swap').addEventListener('click', function () {
            if (!spares.length) return;
            current[index] = spares.shift();
            renderQuestion();
        });

        quiz.addEventListener('submit', function (event) {
            event.preventDefault();
            var answer = input.value.trim();
            if (!answer) {
                var row = el('answer-row');
                row.classList.remove('shake');
                void row.offsetWidth;
                row.classList.add('shake');
                input.focus();
                return;
            }
            answers.push({ id: current[index].id, answer: answer });
            index += 1;
            if (index < data.perGame) {
                renderQuestion();
            } else {
                send();
            }
        });

        function send() {
            show('loading');
            fetch('/sua-idade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ answers: answers })
            })
                .then(function (res) {
                    return res.json().catch(function () { return {}; }).then(function (body) {
                        if (!res.ok || typeof body.idade !== 'number') {
                            throw new Error(body.error || 'O Diogenes se perdeu nas contas. Tente de novo.');
                        }
                        return body;
                    });
                })
                .then(renderResult)
                .catch(function (err) {
                    el('failure-text').textContent = err.message || 'Falha de conexão. Tente de novo.';
                    show('failure');
                });
        }

        function renderResult(body) {
            el('result-age').textContent = String(body.idade);
            el('result-comment').textContent = body.comentario;
            var list = el('result-clues');
            list.innerHTML = '';
            (body.pistas || []).forEach(function (clue) {
                var li = document.createElement('li');
                li.textContent = clue;
                list.appendChild(li);
            });
            el('result-clues-box').hidden = !list.children.length;
            var text = 'O Diogenes disse que eu tenho ' + body.idade + ' anos 😅 Descubra a sua: ' + data.pageUrl;
            el('share').href = 'https://wa.me/?text=' + encodeURIComponent(text);
            show('result');
        }

        el('retry').addEventListener('click', send);

        show('quiz');
        renderQuestion();
    })();
</script>
<?php endif; ?>
</body>
</html>
