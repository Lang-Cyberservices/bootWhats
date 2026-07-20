<!doctype html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <title>Diogenes — bot de moderação para WhatsApp</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Diogenes: bot de moderação para grupos de WhatsApp. Conheça o projeto e a lista de comandos.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #050805;
            --panel: #0a120a;
            --green: #33ff66;
            --green-dim: #1fa348;
            --green-faint: rgba(51, 255, 102, 0.18);
            --green-soft: #8fe6a8;
            --amber: #ffb000;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        html { scroll-behavior: smooth; }

        body {
            background: var(--bg);
            color: var(--green);
            font-family: 'VT323', monospace;
            font-size: clamp(18px, 2.2vw, 22px);
            line-height: 1.35;
            overflow-x: hidden;
            text-shadow: 0 0 6px rgba(51, 255, 102, 0.35);
        }

        /* scanlines + vinheta de CRT */
        body::before {
            content: '';
            position: fixed;
            inset: 0;
            pointer-events: none;
            z-index: 10;
            background:
                repeating-linear-gradient(
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
            max-width: 1080px;
            margin: 0 auto;
            padding: clamp(16px, 4vw, 48px);
        }

        a { color: var(--green); }
        a:hover { color: var(--bg); background: var(--green); text-shadow: none; }

        h1, h2 {
            font-family: 'Press Start 2P', monospace;
            text-transform: uppercase;
        }

        /* ── hero ─────────────────────────────── */
        .hero {
            border: 2px solid var(--green-dim);
            border-radius: 8px;
            padding: clamp(20px, 4vw, 40px);
            margin-bottom: clamp(28px, 5vw, 56px);
            display: flex;
            align-items: center;
            gap: clamp(20px, 4vw, 40px);
            flex-wrap: wrap;
            background: var(--panel);
            box-shadow: 0 0 24px var(--green-faint), inset 0 0 40px rgba(51, 255, 102, 0.05);
        }

        .hero img {
            width: clamp(120px, 20vw, 180px);
            height: clamp(120px, 20vw, 180px);
            object-fit: cover;
            border-radius: 6px;
            border: 2px solid var(--green-dim);
            filter: grayscale(1) sepia(1) hue-rotate(70deg) saturate(3) brightness(0.9);
            flex-shrink: 0;
        }

        .hero-text { flex: 1 1 280px; min-width: 0; }

        .hero h1 {
            font-size: clamp(20px, 4.5vw, 40px);
            letter-spacing: 0.06em;
            margin-bottom: 14px;
            word-break: break-word;
        }

        .hero .tagline { font-size: clamp(20px, 2.6vw, 26px); }

        .hero .version { color: var(--green-dim); margin-top: 10px; }

        .cursor {
            display: inline-block;
            width: 0.55em;
            height: 1em;
            background: var(--green);
            vertical-align: text-bottom;
            animation: blink 1s steps(1) infinite;
        }
        @keyframes blink { 50% { opacity: 0; } }

        /* ── seções ───────────────────────────── */
        section { margin-bottom: clamp(32px, 6vw, 64px); }

        h2 {
            font-size: clamp(14px, 2.6vw, 20px);
            margin-bottom: 20px;
            color: var(--amber);
            text-shadow: 0 0 8px rgba(255, 176, 0, 0.4);
        }
        h2::before { content: '[ '; }
        h2::after { content: ' ]'; }

        .section-hint {
            color: var(--green-dim);
            margin: -12px 0 18px;
        }

        .sobre {
            border: 1px dashed var(--green-dim);
            border-radius: 6px;
            padding: clamp(16px, 3vw, 28px);
            background: var(--panel);
        }
        .sobre p { margin-bottom: 12px; }
        .sobre p:last-child { margin-bottom: 0; }
        .sobre .prompt::before { content: '> '; color: var(--green-dim); }

        /* ── comandos ─────────────────────────── */
        .comandos-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 14px;
        }

        .cmd {
            display: flex;
            flex-direction: column;
            gap: 6px;
            text-align: left;
            border: 1px solid var(--green-dim);
            border-radius: 6px;
            padding: 14px 16px;
            background: var(--panel);
            color: var(--green);
            font: inherit;
            text-shadow: inherit;
            cursor: pointer;
            transition: box-shadow 0.15s, border-color 0.15s;
        }
        .cmd:hover, .cmd:focus-visible {
            border-color: var(--green);
            box-shadow: 0 0 16px var(--green-faint);
            outline: none;
        }

        .cmd .name {
            font-size: 1.1em;
            font-weight: bold;
            word-break: break-word;
        }
        .cmd .name::before { content: '> '; color: var(--green-dim); }

        .cmd .desc { color: var(--green-soft); text-shadow: 0 0 4px rgba(143, 230, 168, 0.25); }

        .cmd .more {
            margin-top: auto;
            padding-top: 4px;
            color: var(--green-dim);
            font-size: 0.85em;
        }
        .cmd:hover .more, .cmd:focus-visible .more { color: var(--amber); }

        .badge-adm {
            display: inline-block;
            font-family: 'Press Start 2P', monospace;
            font-size: 9px;
            color: var(--bg);
            background: var(--amber);
            padding: 3px 6px;
            border-radius: 3px;
            margin-left: 8px;
            vertical-align: middle;
            text-shadow: none;
        }

        /* ── modal ────────────────────────────── */
        dialog.cmd-modal {
            width: min(92vw, 640px);
            max-height: 85vh;
            overflow-y: auto;
            border: 2px solid var(--green);
            border-radius: 8px;
            background: var(--panel);
            color: var(--green);
            font-family: 'VT323', monospace;
            font-size: clamp(18px, 2.2vw, 21px);
            line-height: 1.35;
            text-shadow: 0 0 6px rgba(51, 255, 102, 0.35);
            padding: clamp(18px, 3vw, 30px);
            box-shadow: 0 0 40px var(--green-faint), inset 0 0 40px rgba(51, 255, 102, 0.05);
        }
        dialog.cmd-modal::backdrop {
            background: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(2px);
        }

        .modal-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 14px;
        }

        .modal-title {
            font-family: 'Press Start 2P', monospace;
            font-size: clamp(12px, 2.4vw, 16px);
            word-break: break-word;
            line-height: 1.6;
        }

        .modal-close {
            font-family: 'Press Start 2P', monospace;
            font-size: 11px;
            background: none;
            border: 1px solid var(--green-dim);
            border-radius: 4px;
            color: var(--green);
            padding: 8px 10px;
            cursor: pointer;
            flex-shrink: 0;
            text-shadow: inherit;
        }
        .modal-close:hover, .modal-close:focus-visible {
            background: var(--green);
            color: var(--bg);
            text-shadow: none;
            outline: none;
        }

        .cmd-details h3 {
            font-family: 'Press Start 2P', monospace;
            font-size: clamp(10px, 2vw, 12px);
            color: var(--amber);
            text-shadow: 0 0 8px rgba(255, 176, 0, 0.4);
            text-transform: uppercase;
            margin: 20px 0 10px;
        }
        .cmd-details h3::before { content: '[ '; }
        .cmd-details h3::after { content: ' ]'; }

        .cmd-details p { margin-bottom: 10px; color: var(--green-soft); }
        .cmd-details p strong, .cmd-details li strong { color: var(--green); }

        .cmd-details ul { list-style: none; margin-bottom: 10px; }
        .cmd-details li {
            color: var(--green-soft);
            margin-bottom: 6px;
            padding-left: 1.1em;
        }
        .cmd-details li::before {
            content: '- ';
            color: var(--green-dim);
            margin-left: -1.1em;
        }

        .cmd-details code {
            font-family: 'VT323', monospace;
            color: var(--green);
            background: rgba(51, 255, 102, 0.08);
            border: 1px solid rgba(51, 255, 102, 0.25);
            border-radius: 3px;
            padding: 0 5px;
            white-space: nowrap;
        }

        .examples {
            border: 1px dashed var(--green-dim);
            border-radius: 6px;
            padding: 12px 14px;
            margin-bottom: 10px;
            overflow-x: auto;
        }
        .examples .ex { margin-bottom: 10px; }
        .examples .ex:last-child { margin-bottom: 0; }
        .examples .in { white-space: nowrap; }
        .examples .in::before { content: '> '; color: var(--green-dim); }
        .examples .out { color: var(--green-dim); padding-left: 1.2em; }

        /* ── footer ───────────────────────────── */
        footer {
            border-top: 1px dashed var(--green-dim);
            padding: 28px 0 12px;
            text-align: center;
            color: var(--green-dim);
        }
        footer .admin-link {
            font-family: 'Press Start 2P', monospace;
            font-size: clamp(10px, 1.8vw, 13px);
            text-decoration: none;
            display: inline-block;
            padding: 10px 14px;
            border: 1px solid var(--green-dim);
            border-radius: 4px;
            margin-bottom: 18px;
        }
    </style>
</head>
<body>
<main>
    <header class="hero">
        <img src="/img/diogenes.jpg" alt="Diogenes">
        <div class="hero-text">
            <h1>Diogenes<span class="cursor"></span></h1>
            <p class="tagline">Bot de moderação para grupos de WhatsApp: filtra imagens impróprias, responde comandos, consulta o oráculo e ainda conversa quando mencionado.</p>
            <p class="version">versão 3.1.0</p>
        </div>
    </header>

    <section id="sobre">
        <h2>Sobre</h2>
        <div class="sobre">
            <p class="prompt">Diogenes foi criado por um único programador, com o orçamento de meio sanduíche de presunto, em um tempo muito curto e está hospedado num pc do milhão.</p>
            <p class="prompt">Então falhas podem e irão acontecer. Ao encontrá-las, avise que iremos chicotear o programador até ele corrigir ou morrer tentando.</p>
            <p class="prompt">Para mais informações: <a href="mailto:devteam@devteam.net.br">devteam@devteam.net.br</a> ou 11-994634-2101.</p>
            <p class="prompt">Caso queira ajudar para a continuação do projeto, qualquer ajuda é bem-vinda: <strong>pix@diogenes.ia.br</strong></p>
        </div>
    </section>

    <section id="comandos">
        <h2>Comandos</h2>
        <p class="section-hint">> clique em um comando para ver detalhes e exemplos_</p>
        <div class="comandos-grid">

            <button class="cmd" type="button">
                <span class="name">🔨 /ban<span class="badge-adm">ADMINS</span></span>
                <span class="desc">Remove um usuário do grupo.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li>Responda uma mensagem do usuário com <code>/ban</code>; ou</li>
                        <li>Use <code>/ban @usuario</code> mencionando quem deve sair.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Disponível <strong>apenas para administradores</strong> do grupo. O usuário é removido na hora e a ação fica registrada no log do bot.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/ban @fulano</div><div class="out">remove o fulano mencionado do grupo</div></div>
                        <div class="ex"><div class="in">(respondendo uma mensagem) /ban</div><div class="out">remove o autor da mensagem respondida</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">🚫 /proibir<span class="badge-adm">ADMINS</span></span>
                <span class="desc">Bloqueia uma imagem ou figurinha.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li>Responda a imagem ou figurinha com <code>/proibir</code>.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Disponível <strong>apenas para administradores</strong>. A mídia é apagada e sua assinatura fica bloqueada: se alguém enviar o mesmo conteúdo de novo, o bot remove automaticamente.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">(respondendo uma figurinha) /proibir</div><div class="out">apaga a figurinha e bloqueia reenvios</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">🔮 /oraculo</span>
                <span class="desc">Sua previsão mística da semana.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/oraculo</code> (ou <code>/oráculo</code>), sem parâmetros.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>O oráculo consulta os astros (e uma IA) e entrega uma previsão personalizada. A previsão é <strong>uma por semana</strong>: consultas repetidas na mesma semana retornam a mesma profecia.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/oraculo</div><div class="out">🔮 sua previsão da semana, direto do plano astral</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">✨ /horoscopo · /signo</span>
                <span class="desc">Horóscopo do dia do seu signo.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/horoscopo</code> — usa o signo já cadastrado e retorna o horóscopo do dia.</li>
                        <li><code>/horoscopo [signo]</code> — cadastra/atualiza seu signo e já retorna a previsão.</li>
                        <li><code>/signo</code> e <code>/horóscopo</code> funcionam igual.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Signos aceitos (em português): <strong>áries, touro, gêmeos, câncer, leão, virgem, libra, escorpião, sagitário, capricórnio, aquário e peixes</strong> — com ou sem acento.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/signo touro</div><div class="out">cadastra Touro ♉ e responde a previsão do dia</div></div>
                        <div class="ex"><div class="in">/horoscopo</div><div class="out">previsão do dia do seu signo cadastrado</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">🎲 /d — dados de RPG</span>
                <span class="desc">Rolagens de dados no estilo RPG.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/d [expressão]</code> — ex.: <code>/d 2d6</code>; ou</li>
                        <li>Forma compacta, direto no comando: <code>/2d6</code>, <code>/d20</code>, <code>/4d6h3</code>.</li>
                    </ul>
                    <h3>Tipos de rolagem</h3>
                    <ul>
                        <li><strong>Dado único</strong>: <code>/d20</code> rola 1 dado de 20 faces.</li>
                        <li><strong>Vários dados</strong>: <code>NdF</code> rola N dados de F faces — <code>/3d6</code> soma 3 dados de 6.</li>
                        <li><strong>Blocos somados</strong>: junte blocos com <code>+</code> — <code>/d 2d6+1d4</code>.</li>
                        <li><strong>Modificador final</strong>: <code>+N</code> ou <code>-N</code> no fim — <code>/2d6+3</code>, <code>/d20-2</code>.</li>
                        <li><strong>Manter maiores</strong> (<code>h</code> de high): <code>/4d6h3</code> rola 4d6 e soma só os 3 maiores.</li>
                        <li><strong>Manter menores</strong> (<code>l</code> de low): <code>/2d20l1</code> rola 2d20 e usa o menor.</li>
                        <li><strong>Repetir a rolagem</strong>: prefixo <code>Nx</code> — <code>/3x1d20</code> faz 3 rolagens separadas.</li>
                        <li><strong>Tudo junto</strong>: <code>/2x2d6h1+2</code> — 2 linhas de "2d6, pega o maior, +2".</li>
                    </ul>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/d20</div><div class="out">teste simples de d20</div></div>
                        <div class="ex"><div class="in">/2d20h1</div><div class="out">rolagem com vantagem (usa o maior)</div></div>
                        <div class="ex"><div class="in">/2d20l1</div><div class="out">rolagem com desvantagem (usa o menor)</div></div>
                        <div class="ex"><div class="in">/d 1d8+1d6+3</div><div class="out">dano: 1d8 + 1d6 + 3 fixo</div></div>
                        <div class="ex"><div class="in">/6x4d6h3</div><div class="out">6 atributos clássicos de D&D (4d6, soma os 3 maiores)</div></div>
                    </div>
                    <h3>Limites</h3>
                    <p>Até <strong>20 repetições</strong> por comando, <strong>100 dados</strong> por bloco e <strong>1000 faces</strong> por dado.</p>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">😂 /piada</span>
                <span class="desc">Uma piada aleatória do bot.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/piada</code>, sem parâmetros.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Sorteia uma piada do acervo do Diogenes. A qualidade não é garantida — o orçamento era meio sanduíche de presunto.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/piada</div><div class="out">😂 uma piada aleatória do acervo</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">🎱 /pergunta · /bola8 · /8ball</span>
                <span class="desc">A bola 8 responde sua pergunta.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/pergunta [sua pergunta]</code> — a pergunta é obrigatória.</li>
                        <li><code>/bola8</code> e <code>/8ball</code> funcionam igual.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>O bot responde com uma <strong>imagem da bola 8 mágica</strong> trazendo o veredito. Perguntas de sim ou não funcionam melhor.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/pergunta vou ficar rico?</div><div class="out">🎱 imagem da bola 8 com a resposta do destino</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">🗳️ /sorteio</span>
                <span class="desc">Sorteia alguém do grupo ou de uma enquete.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><strong>Respondendo uma enquete</strong> com <code>/sorteio</code>: sorteia entre quem <strong>votou</strong> nela.</li>
                        <li><strong>Sem responder nada</strong>: sorteia um participante qualquer do grupo.</li>
                    </ul>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">(respondendo uma enquete) /sorteio</div><div class="out">🗳️ sorteia um dos votantes da enquete</div></div>
                        <div class="ex"><div class="in">/sorteio</div><div class="out">🎲 sorteia um participante do grupo</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">🖼️ /sticker</span>
                <span class="desc">Transforma imagem ou GIF em figurinha.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li>Responda uma imagem ou GIF com <code>/sticker</code>.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>O bot converte a mídia respondida em figurinha e envia no grupo. GIFs viram figurinhas animadas.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">(respondendo uma imagem) /sticker</div><div class="out">🖼️ devolve a imagem como figurinha</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">📊 /rank</span>
                <span class="desc">Top 5 de mensagens e comandos.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/rank</code> — ranking geral.</li>
                        <li><code>/rank diario</code>, <code>/rank semanal</code> ou <code>/rank mensal</code> — ranking do período.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Mostra dois top 5: <strong>quem mais fala</strong> (mensagens) e <strong>quem mais usa o bot</strong> (comandos).</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/rank</div><div class="out">📊 top 5 gerais do grupo</div></div>
                        <div class="ex"><div class="in">/rank semanal</div><div class="out">📊 top 5 da semana</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">🗞️ /noticias · /news</span>
                <span class="desc">Principais notícias do dia.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/noticias</code> ou <code>/news</code>, sem parâmetros.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Retorna até <strong>5 manchetes principais</strong> do dia com os links.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/noticias</div><div class="out">🗞️ as 5 principais manchetes de hoje</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">💱 /cotacao</span>
                <span class="desc">Cotações de moedas em BRL.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/cotacao</code> — retorna todas as cotações.</li>
                        <li><code>/cotacao [moeda]</code> — retorna só a moeda escolhida.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Moedas aceitas: <strong>dollar</strong>, <strong>dollar canadense</strong>, <strong>yen</strong>, <strong>euro</strong>, <strong>libra</strong>, <strong>yuan</strong> (ou renminbi) e <strong>bitcoin</strong> — sempre em relação ao real (BRL). O comando tem um <strong>intervalo mínimo entre usos</strong> no grupo; se alguém usou há pouco, o bot pede para aguardar.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/cotacao</div><div class="out">💱 todas as moedas + bitcoin em BRL</div></div>
                        <div class="ex"><div class="in">/cotacao euro</div><div class="out">💱 só a cotação do euro</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">🕵️ /check</span>
                <span class="desc">Estatísticas de um usuário.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/check @usuario</code> — mencione quem quer investigar.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Mostra as estatísticas do usuário: <strong>mensagens</strong> (hoje, semana, mês e geral), <strong>imagens removidas</strong> pela moderação e <strong>uso de comandos</strong>.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/check @fulano</div><div class="out">🕵️ dossiê completo de atividade do fulano</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">📚 /books · /livros</span>
                <span class="desc">Biblioteca virtual e recomendações.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/books</code> ou <code>/livros</code>, sem parâmetros.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Exibe os <strong>links ativos da biblioteca virtual</strong>, o <strong>top de livros</strong> da última segunda-feira e a <strong>recomendação mais recente do Dio</strong>.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/livros</div><div class="out">📚 links da biblioteca + top + recomendação do Dio</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">ℹ️ /sobre</span>
                <span class="desc">Sobre o bot e quem desenvolveu.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/sobre</code>, sem parâmetros.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Mostra o resumo do projeto: quem criou, como reportar falhas, contatos e a versão atual — o mesmo conteúdo da seção <strong>Sobre</strong> desta página.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/sobre</div><div class="out">🤖 história, contatos e versão do bot</div></div>
                    </div>
                </div>
            </button>

            <button class="cmd" type="button">
                <span class="name">❓ /ajuda · /help</span>
                <span class="desc">Lista de comandos disponíveis.</span>
                <span class="more">[ + detalhes ]</span>
                <div class="cmd-details" hidden>
                    <h3>Uso</h3>
                    <ul>
                        <li><code>/ajuda</code> ou <code>/help</code>, sem parâmetros.</li>
                    </ul>
                    <h3>Detalhes</h3>
                    <p>Exibe no grupo a lista de todos os comandos com uma descrição curta de cada um.</p>
                    <h3>Exemplos</h3>
                    <div class="examples">
                        <div class="ex"><div class="in">/ajuda</div><div class="out">📖 lista completa de comandos no chat</div></div>
                    </div>
                </div>
            </button>

        </div>
    </section>

    <footer>
        <a class="admin-link" href="/admin">[ acesso administrativo ]</a>
        <p>diogenes v3.1.0 — rodando num pc do milhão</p>
    </footer>
</main>

<dialog class="cmd-modal" id="cmd-modal">
    <div class="modal-top">
        <div class="modal-title" id="cmd-modal-title"></div>
        <button class="modal-close" type="button" id="cmd-modal-close">[ x ]</button>
    </div>
    <div class="cmd-details" id="cmd-modal-body"></div>
</dialog>

<script>
    (function () {
        var modal = document.getElementById('cmd-modal');
        var title = document.getElementById('cmd-modal-title');
        var body = document.getElementById('cmd-modal-body');

        document.querySelectorAll('.cmd').forEach(function (card) {
            card.addEventListener('click', function () {
                var details = card.querySelector('.cmd-details');
                if (!details) return;
                title.innerHTML = card.querySelector('.name').innerHTML;
                body.innerHTML = details.innerHTML;
                modal.showModal();
            });
        });

        document.getElementById('cmd-modal-close').addEventListener('click', function () {
            modal.close();
        });

        // clique no backdrop fecha o modal
        modal.addEventListener('click', function (event) {
            if (event.target === modal) {
                modal.close();
            }
        });
    })();
</script>
</body>
</html>
