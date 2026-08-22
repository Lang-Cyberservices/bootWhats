-- Announce version 4.0. sent defaults to false, so VersionAnnouncer broadcasts it
-- to every group on the next bot restart and then marks it sent.
INSERT INTO version_announcements (version, notes, createdAt)
VALUES (
    '4.0',
    '🚀 Diógenes chegou à versão 4! 🤖🎉

E não, ele não ficou só mais velho… ficou mais rápido e mais esperto! ⚡🧠

✨ O que tem de novo?
🏎️ Melhorias de desempenho para deixar tudo mais ágil
🖼️ Sistema de filtro de imagens aprimorado — esperamos mandar os falsos positivos para bem longe! 👋😂
🎮 E tem jogo novo! 👀

Quer descobrir qual é?
👉 Digite /letreco no grupo e bora jogar! 🔤🔥
quer saber mais sobre ele?

🌐 https://diogenes.ia.br',
    NOW()
);
