-- Backfill: preserve the version currently hardcoded in /sobre before it started
-- reading from this table. sent=true because there is no group announcement for it —
-- it's just history, not a new release.
INSERT INTO version_announcements (version, notes, sent, sentAt, createdAt)
VALUES ('3.1.0', 'Versão inicial registrada no sistema de avisos.', true, NOW(), NOW());
