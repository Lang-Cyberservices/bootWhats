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

# Calibrate moderation: score a folder with NSFWJS + every LAION variant,
# write labels.csv, print confusion matrix and threshold sweep. Read-only.
node tools/nsfw_eval.js storage/eval --variants=b32-legacy,b32,l14

# Chess board renderer + rules check (no WhatsApp, no DB)
node tools/xadrez_preview.js "e4 e5 Nf3 Nc6 Bb5" /tmp/board.png
node tools/xadrez_preview.js --rules

# LAION scoring (optional, requires Python venv)
python3 -m venv .venv
./.venv/bin/pip install torch torchvision
LAION_PYTHON=./.venv/bin/python node tools/validate_evidence_md5.js /path/to/image.webp
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
WhatsApp or DB coupling. `nsfwScore` ≥ 0.95 → NSFW. 0.65–0.95 → second opinion from LAION.
`isNsfw: null` means undecidable (LAION down) — the job retries and nothing is cached or deleted.

`LaionClient` keeps **one** Python process alive (`tools/laion_score.py --serve`) instead of
spawning one per image: the CLIP + safety model load costs ~90s, which used to be paid on every
single image; subsequent scores take ~50ms. It kills the child on `SIGINT`/`SIGTERM`/`exit` and
shuts it down after `LAION_IDLE_SHUTDOWN_MS` of inactivity to give back ~1.5 GB.

**LAION variants and the QuickGELU fix.** `LAION_VARIANT` selects a matched pair of CLIP backbone
and classification head (`VARIANTS` in `tools/laion_score.py`) — they must agree on embedding
dimension, so one knob controls both. The `openai` CLIP weights were trained with QuickGELU, but
open_clip 3.x builds plain `ViT-B-32` without it; the embeddings came out wrong and the LAION head,
trained on correct ones, scored everything near zero. Measured on the same image: **0.0617 with the
bug, 0.4804 corrected.** That is why production ran `LAION_THRESHOLD=0.03` — it was compensating.
With the fix that threshold blocks almost everything, so the worker warns at boot when a corrected
variant runs below 0.1. `b32-legacy` reproduces the bug on purpose, as a baseline for
`tools/nsfw_eval.js`. Thresholds must be re-derived from data after any variant change.

Set `IMAGE_ANALYSIS_MODE=inline` to fall back to analyzing inside the bot process (the pre-queue
behavior) without a redeploy.

**Services**
| File | Role |
|------|------|
| `database.js` | Prisma + MariaDB driver adapter; exports `prisma` singleton |
| `MediaIngest.js` | Bot side of image moderation: download, MD5, cache check, enqueue |
| `MediaQueue.js` | All access to `media_analysis_jobs`; shared by bot and worker |
| `VerdictDispatcher.js` | Applies finished verdicts (delete + warn) in the bot process |
| `ImageAnalyzer.js` | Pure NSFW scoring engine (sharp + NSFWJS + LAION), no side effects |
| `analyzer/worker.js` | Entry point of the `bootwhats-analyzer` process |
| `analyzer/LaionClient.js` | Keeps the LAION Python process alive and serialized |
| `AuditLogger.js` | Writes structured events to the `logs` table via Prisma |
| `OracleService.js` | Weekly horoscope-like predictions via Gemini API; cached per phone+week in `oracle_predictions` |
| `StatsCounter.js` | Buffers message/command counts in memory, flushes to `message_stats` and `message_stats_buckets` periodically |
| `DiceRoller.js` | Parses dice notation (e.g. `2d6+3`) from messages |
| `WelcomeService.js` | Sends welcome messages on `group_join` events using config from `welcome_configs` table |
| `MessageFilter.js` | Keyword-based message filter (currently commented out in `index.js`) |
| `mediaUtils.js` | Saves deleted media as evidence files |
| `messageUtils.js` | Extracts consistent sender IDs from messages |
| `games/forca.js` | `/forca` — hangman, free-for-all, static images from `storage/forca/` |
| `games/xadrez.js` | `/xadrez` — 1v1 chess, rules via `chess.js`, strict turns, expiry sweeper |
| ↳ `/xadrez solo` | Hidden mode, `DEV_GROUP_ID` only: plays against "Diogenes", who picks a random legal move from `chess.moves()`. Everything else (scoring, 10-move minimum, persistence) runs through the normal code path, so a solo game exercises the whole feature — including a `diogenes@bot` row in `game_scores`. Outside the dev group the argument is refused with a canned line. |
| `games/chessBoard.js` | Renders the chess board PNG with `canvas` (sprites in `storage/xadrez/pieces/`) |

Games follow a shared pattern: in-memory `Map` keyed by `chatId`, write-through to Prisma so a
restart rehydrates via `loadActiveGames()`, and player input arrives as a **reply to the bot's last
round message** (matched against `roundMessageIds`) rather than as a command. Non-command messages
reach them from the `if (!isCommand)` block in `index.js`. Aggregate points for every game live in
`game_scores`, keyed by `gameType` (`forca`, `xadrez`).

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
- `IMAGE_ANALYSIS_MODE` — `queue` (default) or `inline` to analyze inside the bot process
- `MEDIA_SPOOL_DIR` — where the bot parks downloaded media until the worker consumes it
- `LAION_PYTHON` / `LAION_SCRIPT` / `LAION_IDLE_SHUTDOWN_MS` — the persistent LAION sidecar

## Node version

Node.js 22 LTS is required (pinned in `.node-version`). Note that `@tensorflow/tfjs-node` may break on Node 24+.
