-- Announce version 4.3. sent defaults to false, so VersionAnnouncer broadcasts it
-- to every group on the next bot restart and then marks it sent.
INSERT INTO version_announcements (version, notes, createdAt)
VALUES (
    '4.3',
    '🚀 Diógenes chegou à versão 4.3! 🤖✨

Tem três comandos novos saindo do barril:

🎥 /video link
Manda o link e eu trago o vídeo aqui pro grupo (até 5 minutos).

🎵 /musica link
Só quer ouvir? Eu baixo o áudio e envio em mp3 (até 10 minutos).

🏺 /dio sua pergunta
Pergunte qualquer coisa ao próprio Diógenes. Ele responde com a sinceridade de sempre — gentileza não está incluída. 😏 (3 perguntas por dia)

⏳ Os downloads podem levar um minutinho. Se não vier de primeira, é só tentar de novo.

🔧 Também fizemos melhorias gerais no sistema para deixar tudo mais estável.

📖 Lista completa de comandos:
🌐 https://diogenes.ia.br',
    NOW()
);
