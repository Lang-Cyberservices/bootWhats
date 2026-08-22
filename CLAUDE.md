# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

BootWhats is a WhatsApp group moderation bot built on `whatsapp-web.js` (Puppeteer/Chromium). It listens to group messages, moderates NSFW images via a local TensorFlow/NSFWJS model, handles slash commands, and optionally connects to a local LLM (Ollama) to respond when mentioned.

## Commands

```bash
# Start the bot (scans QR on first run)
node index.js

# Start the image-analysis worker (separate process; required for moderation)
node services/analyzer/worker.js

# Both at once, the way production runs them
pm2 start ecosystem.config.js

# Database (MariaDB via Docker)
docker compose up -d
npx prisma migrate deploy      # apply migrations
npx prisma generate            # regenerate client after schema changes

# Management panel (PHP built-in server; router.php enables the /admin path)
php -S localhost:8080 -t tools/gestao/public tools/gestao/public/router.php

# Validate a local image against NSFW logic (returns JSON)
node tools/validate_evidence_md5.js /path/to/image.webp

# Calibrate moderation: score a folder with every NSFWJS model, write labels.csv,
# print confusion matrix and threshold sweep. NSFWJS only — no LAION. Read-only.
node tools/nsfw_eval.js storage/eval --models=inception_v3,mobilenet_v2_mid --limiar=0,95

# Chess board renderer + rules check (no WhatsApp, no DB)
node tools/xadrez_preview.js "e4 e5 Nf3 Nc6 Bb5" /tmp/board.png
node tools/xadrez_preview.js --rules

# Letreco board renderer + scorer/normalizer check (no WhatsApp, no DB)
node tools/letreco_preview.js "CASA" "CAMA,SACO,AAAA" /tmp/letreco.png
node tools/letreco_preview.js --rules
```

There are no automated tests (`npm test` exits with an error by design).

## Architecture

**Two processes**
Image analysis runs in its own process (`bootwhats-analyzer`), separate from the bot
(`bootwhats`). This is not optional plumbing: `model.classify` from `tfjs-node` blocks the event
loop of whichever process runs it, and when that was the bot's loop, the Puppeteer CDP responses
stalled and replies took minutes. The two processes share MariaDB and a spool directory; nothing
else. See `ecosystem.config.js`.

**Entry point — `index.js`**
Initializes in sequence: database → media ingest/dispatcher → WhatsApp client. The bot only starts
if the DB connection succeeds. In the default `queue` mode it never loads `tfjs-node` or `sharp`.
The WhatsApp session persists in `.wwebjs_auth/`.

**Message pipeline (every group message)**
1. `MediaIngest` — tries to avoid the download entirely first: WhatsApp ships a `filehash` (SHA256
   of the original file, stable across senders) in `msg.rawData`, so an image already judged is
   resolved straight from `media_hashes`, and one already queued reuses the spooled file. Only on a
   miss does it call `downloadMedia()`, compute the MD5, check `media_hashes` again, write to
   `MEDIA_SPOOL_DIR` and enqueue in `media_analysis_jobs`. Not every WhatsApp Web build exposes
   `filehash`, so every shortcut is guarded and falls back to the download path. No inference
   happens in the bot process.
2. `CommandHandler` — handles `/`-prefixed commands. Rate-limited in memory (`commandHistoryByUser` map). All commands are in this single large class (`services/CommandHandler.js`).
3. `LlamaResponder` — calls a local Ollama-compatible endpoint when the bot is @mentioned or someone replies to its message.

`VerdictDispatcher` polls `media_analysis_jobs` every `VERDICT_POLL_MS` for finished NSFW verdicts,
rehydrates the message with `client.getMessageById` and deletes it. Failures to delete (message gone,
outside WhatsApp's deletion window) are logged as `IMAGE_DELETE_FAILED` rather than swallowed.

**Analysis worker — `services/analyzer/worker.js`**
Claims one job at a time from `media_analysis_jobs`, so concurrency is 1 by construction. Consults
`media_hashes` *before* reading the spool file — several messages carrying the same image share one
file and one inference. Jobs stuck in `processing` past `JOB_LOCK_TIMEOUT_MS` return to the queue;
after `JOB_MAX_ATTEMPTS` they become `failed`. The worker exits every
`ANALYZER_MAX_JOBS_BEFORE_EXIT` jobs so PM2 recycles it and native TF memory is reclaimed.

`ImageAnalyzer` is now a pure engine: `analyze(buffer, { mimetype, isSticker, filePath })` with no
WhatsApp or DB coupling. `nsfwScore` is `max(Porn, Sexy, Hentai)`; below `NSFW_VISION_GATE` (0.3) it
passes, and **above the gate the verdict is always Google Vision's** — NSFWJS never blocks on its
own. `isNsfw: null` means undecidable (Vision down) — the job retries and nothing is cached or
deleted. Note what that costs: with no local hard block, a missing API key means everything above
the gate is retried `JOB_MAX_ATTEMPTS` times and then passes, so the worker warns loudly at boot.

**NSFWJS models.** Production loads `models/inception_v3`, which is the v1.0 artifact from
`GantMan/nsfw_model` — the only Inception v3 ever published, so there is no newer version of it.
There *is* a newer weights release, v1.1.0 (2020), but it ships a different architecture:
`nsfw_mobilenet_v2_140_224`, which nsfwjs exposes as `MobileNetV2Mid` and bundles inside the npm
package (no download). `tools/nsfw_eval.js` scores both so the choice can be made on data. Upgrading
the nsfwjs *library* (4.2.1 → 4.4.0) changes no weights and buys no accuracy.

**Google Vision SafeSearch** (`analyzer/VisionClient.js`) replaced the LAION sidecar — a Python
process holding ~1.5 GB of CLIP resident, paid for by every restart. It is a plain REST call with
`fetch`, authenticated by `GOOGLE_VISION_API_KEY` in the query string; the official SDK only accepts
service accounts and would drag in gRPC/protobuf for one endpoint. Blocking happens when `adult` or
`racy` reaches `GOOGLE_VISION_ADULT_LEVEL` / `GOOGLE_VISION_RACY_LEVEL` (default `LIKELY`, compared
on the API's own scale, `UNKNOWN` ranked lowest so it never blocks alone).

Every failure path in `VisionClient` throws, deliberately: that is what `ImageAnalyzer` turns into
`isNsfw: null`. Returning an optimistic verdict there would silently release content whenever the
API was down. The image sent to Vision is **not** the 299×299 tensor frame — that one is distorted by
`fit: 'fill'`. `getSafeSearch` re-renders from the original buffer at ≤1024px JPEG, always a single
frame (`page: 0`), because Vision handles animated webp/gif poorly.

`tools/nsfw_eval.js` measures NSFWJS alone against a single threshold and writes a pt-BR CSV
(`;` separator, comma decimals). It does not call Vision — labelling a corpus should not cost API
requests.

Set `IMAGE_ANALYSIS_MODE=inline` to fall back to analyzing inside the bot process (the pre-queue
behavior) without a redeploy.

**Services**
| File | Role |
|------|------|
| `database.js` | Prisma + MariaDB driver adapter; exports `prisma` singleton |
| `MediaIngest.js` | Bot side of image moderation: download, MD5, cache check, enqueue |
| `MediaQueue.js` | All access to `media_analysis_jobs`; shared by bot and worker |
| `VerdictDispatcher.js` | Applies finished verdicts (delete + warn) in the bot process |
| `ImageAnalyzer.js` | Pure NSFW scoring engine (sharp + NSFWJS + Vision), no side effects |
| `analyzer/worker.js` | Entry point of the `bootwhats-analyzer` process |
| `analyzer/VisionClient.js` | Google Vision SafeSearch over REST; throws on every failure |
| `AuditLogger.js` | Writes structured events to the `logs` table via Prisma |
| `ErrorLogger.js` | Persists fatal/unexpected errors to `error_logs`; never throws itself |
| `OracleService.js` | Weekly horoscope-like predictions via Gemini API; cached per phone+week in `oracle_predictions` |
| `StatsCounter.js` | Buffers message/command counts in memory, flushes to `message_stats` and `message_stats_buckets` periodically |
| `DiceRoller.js` | Parses dice notation (e.g. `2d6+3`) from messages |
| `WelcomeService.js` | Sends welcome messages on `group_join` events using config from `welcome_configs` table |
| `VersionAnnouncer.js` | Broadcasts pending rows from `version_announcements` on the `ready` event, then marks them sent |
| `MessageFilter.js` | Keyword-based message filter (currently commented out in `index.js`) |
| `mediaUtils.js` | Saves deleted media as evidence files |
| `messageUtils.js` | Extracts consistent sender IDs from messages |
| `games/forca.js` | `/forca` — hangman, free-for-all, static images from `storage/forca/` |
| `games/xadrez.js` | `/xadrez` — 1v1 chess, rules via `chess.js`, strict turns, expiry sweeper |
| ↳ `/xadrez solo` | Hidden mode, `DEV_GROUP_ID` only: plays against "Diogenes", who picks a random legal move from `chess.moves()`. Everything else (scoring, 10-move minimum, persistence) runs through the normal code path, so a solo game exercises the whole feature — including a `diogenes@bot` row in `game_scores`. Outside the dev group the argument is refused with a canned line. |
| `games/chessBoard.js` | Renders the chess board PNG with `canvas` (sprites in `storage/xadrez/pieces/`) |
| `games/letreco.js` | `/letreco` — Wordle in the group: one shared board, 10 attempts, guesses arrive as replies |
| `games/letrecoWords.js` | Pure normalizer + two-pass green/yellow/red scorer; no Prisma, no WhatsApp |
| `games/letrecoBoard.js` | Renders the letreco board PNG with `canvas` (letters drawn, no sprites) |

Games follow a shared pattern: in-memory `Map` keyed by `chatId`, write-through to Prisma so a
restart rehydrates via `loadActiveGames()`, and player input arrives as a **reply to the bot's last
round message** (matched against `roundMessageIds`) rather than as a command. Non-command messages
reach them from the `if (!isCommand)` block in `index.js`. Aggregate points for every game live in
`game_scores`, keyed by `gameType` (`forca`, `xadrez`, `letreco`) — the 🎮 section of `/rank` groups
by `authorId` without filtering `gameType`, so a new game shows up there for free.

`/letreco` is the strictest use of that pattern: a guess only counts as a reply to
`currentRoundMessageId`, and a reply to an older board is answered with "tabuleiro desatualizado"
instead of being applied — that plus the in-memory `processing` flag is what serializes two people
answering the same board at the same instant. Nothing but an accepted guess consumes an attempt or
changes whose turn it is; a wrong length, a stale board or the 60 s same-player cooldown all leave
the game untouched. Guesses are **not** checked against the category bank — the deliberate choice
was to let people probe letters with any word of the right length; `isGuessAcceptable()` is the one
place to change if that ever flips.

**Database (Prisma + MariaDB)**
Schema lives in `prisma/schema.prisma`. Key models: `Log`, `MediaHash`, `MediaAnalysisJob`, `OraclePrediction`, `MessageStats`, `MessageStatsBucket`, `Admin`, `WelcomeConfig`, `Joke`, `PowerAnimal`, `PhilosopherProtector`, `UserHoroscope`, `DailyHoroscope`.

`media_analysis_jobs` is the analysis queue. It is keyed by `messageId`, not by `md5`: five people
posting the same sticker produce five messages that each need deleting. Deduplication of the
*inference* happens against `media_hashes`.

**WhatsApp client lifecycle**
`client.destroy()` calls `browser.close()`, which hangs forever when Chromium stops responding —
exactly the state that triggers a reconnect. So `destroyClient()` races it against
`CLIENT_DESTROY_TIMEOUT_MS` and then SIGKILLs `client.pupBrowser.process()`. Reconnects are
serialized through a single `reconnectPromise`, because the watchdog and the `disconnected` event
can fire together and used to open a second Chromium. `SIGINT`/`SIGTERM`/`exit` handlers tear the
browser down so `pm2 restart` doesn't leave one orphaned.

**Dev/prod separation**
`APP_ENV=development` enables verbose logging. `DEV_GROUP_ID` restricts the bot to a single WhatsApp group — in dev mode only that group is processed; in prod that group is excluded.

**Version announcements**
`version_announcements` holds rows with `version`, `notes` and a `sent` flag. On the `ready` event,
`VersionAnnouncer.announcePending()` picks up every row where `sent` is false, broadcasts `notes` to
every group the bot is in (`client.getChats()` filtered by `isGroup`, or just `DEV_GROUP_ID` in dev
mode), and marks the row sent — best-effort, so one failing group doesn't cause a resend to
everyone else on the next restart. There is no command or CLI to insert a row: announcing a version
means creating an otherwise-empty migration and hand-editing it to `INSERT` the row, so the
announcement ships in the same PR/deploy as the change it describes:
```bash
npx prisma migrate dev --create-only --name announce_v2_4
# then edit the generated migration.sql:
# INSERT INTO version_announcements (version, notes, createdAt) VALUES ('2.4', 'texto do aviso', NOW());
```
`prisma migrate deploy` in the existing CI pipeline applies it on the next deploy, and the next bot
restart sends it. `/sobre` reads the `version` of the most recent row (`orderBy: { id: 'desc' }`,
regardless of `sent`) to show the current version — so every new announcement migration also updates
what `/sobre` reports, with no separate place to bump.

**Error persistence**
`error_logs` holds fatal/unexpected errors from both processes (`process` is `bot` or `analyzer`),
written through `ErrorLogger.logError(err, { process, context })` — never thrown from itself, only
`console.error`s if the insert fails. This is deliberately narrow, not a mirror of every
`console.error` in the codebase (most command/game failures stay console-only): it covers
process-level failures, a global `uncaughtException`/`unhandledRejection` safety net in both
`index.js` and `services/analyzer/worker.js` (neither existed before this — an error outside any
try/catch used to crash the process with nothing beyond raw pm2 stderr), and the external-API calls
behind `/oraculo`, `/filme`, `/news`, `/livros` (Gemini, TMDB, GNews, publishnews.com.br scrape) —
those are the commands most exposed to third-party outages, so their fetch/HTTP-status failures are
persisted with `context` values like `command./filme` in addition to their existing user-facing
"tente novamente" replies. Both global handlers persist then `process.exit(1)`; pm2's `autorestart`
brings the process back up. The `tools/gestao` admin panel reads this table as its post-login
landing page (`?route=errors`, see `AuthController::login()` and the `default:` case in
`public/index.php`) — rows can be marked `resolved` from there, and the screen shows only unresolved
rows by default (`?all=1` for history).

**HTTP ingest API**
An Express server (`startIngestServer`) listens on `HTTP_INGEST_PORT` (default 5000) and accepts `POST /` with `{ key, message }` to send a message to `HTTP_INGEST_GROUP_ID`. All other routes return 404 with an empty body to avoid fingerprinting.

**CI/CD**
Pushes to `master` trigger `.github/workflows/deploy.yml`, which SSHs into the production server, runs `git pull`, `npm install`, `npx prisma generate`, `npx prisma migrate deploy`, and then `pm2 startOrReload ecosystem.config.js --update-env` to bring up both processes.

The first deploy after the analyzer split needs a one-time `pm2 delete bootwhats` on the server:
the old single-app entry was created with `pm2 start index.js --name bootwhats` and would otherwise
linger alongside the ones from `ecosystem.config.js`.

## Key environment variables

See `.env_example` for all options. Critical ones:
- `DATABASE_URL` — MariaDB connection string (required; bot won't start without it)
- `BOOT_NUMBER` — the bot's own WhatsApp number (used so LlamaResponder can detect replies to itself)
- `GEMINI_API_KEY` / `GEMINI_MODEL` — for the `/oraculo` command
- `LLAMA_ENABLED`, `LLAMA_ENDPOINT`, `LLAMA_MODEL` — for the @mention responder
- `DEV_GROUP_ID` / `APP_ENV` — dev isolation
- `NSFW_EVIDENCE_DIR` — where deleted media evidence is saved (default `./storage/deleted-media`)
- `MAX_COMMANDS_PER_MINUTE` — per-user rate limit (default 3 per 2-minute window)
- `LETRECO_COOLDOWN_MS` / `LETRECO_TIMEOUT_MS` — same-player wait (default 60 s) and idle expiry of a
  letreco match (default 6 h); both exist so the rules can be exercised without waiting
- `IMAGE_ANALYSIS_MODE` — `queue` (default) or `inline` to analyze inside the bot process
- `MEDIA_SPOOL_DIR` — where the bot parks downloaded media until the worker consumes it
- `GOOGLE_VISION_API_KEY` — SafeSearch second opinion; without it nothing above the gate is decided
- `NSFW_VISION_GATE` — NSFWJS score above which Vision is consulted (default `0.3`)
- `GOOGLE_VISION_ADULT_LEVEL` / `GOOGLE_VISION_RACY_LEVEL` — block from this likelihood up (default `LIKELY`)

## Node version

Node.js 22 LTS is required (pinned in `.node-version`). Note that `@tensorflow/tfjs-node` may break on Node 24+.
