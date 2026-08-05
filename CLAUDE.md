# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

BootWhats is a WhatsApp group moderation bot built on `whatsapp-web.js` (Puppeteer/Chromium). It listens to group messages, moderates NSFW images via a local TensorFlow/NSFWJS model, handles slash commands, and optionally connects to a local LLM (Ollama) to respond when mentioned.

## Commands

```bash
# Start the bot (scans QR on first run)
node index.js

# Database (MariaDB via Docker)
docker compose up -d
npx prisma migrate deploy      # apply migrations
npx prisma generate            # regenerate client after schema changes

# Management panel (PHP built-in server; router.php enables the /admin path)
php -S localhost:8080 -t tools/gestao/public tools/gestao/public/router.php

# Validate a local image against NSFW logic (returns JSON)
node tools/validate_evidence_md5.js /path/to/image.webp

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

**Entry point — `index.js`**
Initializes in sequence: database → NSFWJS model → WhatsApp client. The bot only starts if the DB connection succeeds. The WhatsApp session persists in `.wwebjs_auth/`.

**Message pipeline (every group message)**
1. `ImageAnalyzer` — downloads and scores images with NSFWJS (inception_v3 model in `models/`). If `nsfwScore` ≥ 0.95 → immediate ban. If 0.65–0.95 → calls the LAION Python script for a second opinion. MD5 hashes are cached in `media_hashes` to avoid re-scoring.
2. `CommandHandler` — handles `/`-prefixed commands. Rate-limited in memory (`commandHistoryByUser` map). All commands are in this single large class (`services/CommandHandler.js`).
3. `LlamaResponder` — calls a local Ollama-compatible endpoint when the bot is @mentioned or someone replies to its message.

**Services**
| File | Role |
|------|------|
| `database.js` | Prisma + MariaDB driver adapter; exports `prisma` singleton |
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
Schema lives in `prisma/schema.prisma`. Key models: `Log`, `MediaHash`, `OraclePrediction`, `MessageStats`, `MessageStatsBucket`, `Admin`, `WelcomeConfig`, `Joke`, `PowerAnimal`, `PhilosopherProtector`, `UserHoroscope`, `DailyHoroscope`.

**Dev/prod separation**
`APP_ENV=development` enables verbose logging. `DEV_GROUP_ID` restricts the bot to a single WhatsApp group — in dev mode only that group is processed; in prod that group is excluded.

**HTTP ingest API**
An Express server (`startIngestServer`) listens on `HTTP_INGEST_PORT` (default 5000) and accepts `POST /` with `{ key, message }` to send a message to `HTTP_INGEST_GROUP_ID`. All other routes return 404 with an empty body to avoid fingerprinting.

**CI/CD**
Pushes to `master` trigger `.github/workflows/deploy.yml`, which SSHs into the production server, runs `git pull`, `npm install`, `npx prisma generate`, `npx prisma migrate deploy`, and restarts via PM2.

## Key environment variables

See `.env_example` for all options. Critical ones:
- `DATABASE_URL` — MariaDB connection string (required; bot won't start without it)
- `BOOT_NUMBER` — the bot's own WhatsApp number (used so LlamaResponder can detect replies to itself)
- `GEMINI_API_KEY` / `GEMINI_MODEL` — for the `/oraculo` command
- `LLAMA_ENABLED`, `LLAMA_ENDPOINT`, `LLAMA_MODEL` — for the @mention responder
- `DEV_GROUP_ID` / `APP_ENV` — dev isolation
- `NSFW_EVIDENCE_DIR` — where deleted media evidence is saved (default `./storage/deleted-media`)
- `MAX_COMMANDS_PER_MINUTE` — per-user rate limit (default 3 per 2-minute window)

## Node version

Node.js 22 LTS is required (pinned in `.node-version`). Note that `@tensorflow/tfjs-node` may break on Node 24+.
