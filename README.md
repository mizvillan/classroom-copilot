# Classroom Copilot

A local-first command center for Google Classroom work: deadlines ranked by what actually matters, an AI briefing and Study Kits (flashcards, quiz, slides, answers), a phone-friendly installable dashboard, and a Discord bot that answers `/due`, `/next`, `/brief` and `/sync`.

Built for students whose school email is locked down: **no Google Cloud project, no OAuth client, no API keys to Google.** You get your work in by pasting it, or by letting the app read your existing open Classroom browser session.

It runs as **one Node process**. Your classroom data, briefing and study kits stay in `data/` on your machine. Nothing goes to a database or hosting provider.

## What you get

- **Overview** — the top three things to do, overdue/missing work, next-48-hours and this-week counts, a seven-day timeline, and course load.
- **Assignments** — searchable, filterable by priority and course, with points, due dates and direct links back to Classroom. Each row has a **Study kit** button.
- **Study Kits** — for any assignment: 8 flashcards (tap to flip), a 6-question multiple-choice quiz with answers and explanations, a 5-slide presentation outline, a Q&A cheat sheet, and a 4-step study plan. Exportable as Markdown. Written by the AI model chain with a deterministic fallback so it never hard-fails.
- **Briefings** — a short Markdown plan. Ranking is always local and explainable; a model chain can rewrite it as prose.
- **Discord bot** — slash commands, a daily digest, and instant alerts when new coursework appears.
- **Phone-ready** — responsive layouts plus PWA manifest, icons and service worker. Full install needs HTTPS; over Wi-Fi you can still add a home-screen shortcut.
- **AI model chain, zero setup** — a Groq key is baked in and shared with the Mizvillan bot: `qwen/qwen3.8-27b` → `groq/compound-mini` → `openai/gpt-oss-120b`. Anything in `.env` outranks it.

## Quick start

Requirements: Node.js 20.19+.

```bash
cd classroom-copilot
npm install
npm run build
npm start
```

Open <http://localhost:8790>. Until your data is in, the app runs on realistic sample data so you can try every screen. `npm test` covers the priority engine and formatting.

For development (server on 8790, Vite on 5274 with HMR):

```bash
npm run dev
```

## 1. Get your work in (no Google API)

Two ways, both work without any Google Cloud setup:

### Paste import (always works)

1. Open classroom.google.com → your **To-do** page (`classroom.google.com/u/0/a/not-turned-in/all`).
2. Select-all the visible work and copy it.
3. In the app: **Settings → Get your work in**, paste, press **Read my list**.
4. Check the parsed rows (title, course, due date, points, missing) — everything is editable — then **Save items**.

The parser reads course/title/due/points line patterns from several layouts. Anything it can't confidently parse still becomes an editable draft row, so nothing is silently dropped.

### Cookie auto-sync (hands-free)

While a classroom.google.com tab is open, copy your browser's Cookie header from DevTools and save it in `.env`:

```env
CLASSROOM_COOKIES=<the long cookie line>
```

Restart, and the app pulls your Assigned and Missing To-do pages on a schedule (`SYNC_INTERVAL_MINUTES`, default 15) using the same server-side fetch your browser does. No evaluation of page code happens server-side. When Google logs that session out you get a clear error; paste a fresh cookie header.

> Prefer the paste import on a school Chromebook where DevTools is blocked. The cookie approach works great from your own PC.

The old OAuth path still exists for personal (`@gmail.com`) accounts: set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and it uses the Classroom API instead.

## 2. Discord bot (optional but fun)

1. Create a Discord application, Bot → Reset Token → copy it as `DISCORD_BOT_TOKEN`.
2. Restart; an **Invite the bot** link appears in Settings. Invite it with `bot` + `applications.commands` scopes.
3. Right-click your private channel → Copy Channel ID → `DISCORD_CHANNEL_ID`.

Slash commands: `/due` (next 7 days), `/next` (top few now), `/brief` (full briefing also triggers AI), `/sync`. Digest time via `DISCORD_DIGEST_TIME` (default 07:00), new-work ping via `DISCORD_ALERTS`.

## 3. AI chain

Already wired with the baked-in Groq key. To use your own provider:

```env
AI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-...
AI_MODELS=deepseek/deepseek-chat, openai/gpt-4o-mini
```

More keys can be listed comma-separated (`AI_API_KEYS=key1,key2`) and are tried in order. If every model fails, the local planner produces the briefing and Study Kits fall back to a structured outline built from the assignment itself — the features never show an error to a student.

## Deployed access (Render)

`render.yaml` deploys the whole app (server + built frontend) as one web service. Data is ephemeral on free plans; on a persistent disk it survives restarts.

```bash
# after pushing to GitHub
# Render → New → Blueprint → pick the repo → Create
```

Env vars to set there: `SYNCPASS_COOKIES` none required — for cookie sync set `CLASSROOM_COOKIES`; for Discord set `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID`. Vercel/Netlify need no special config either since the Node server owns everything — Render works out of the box, and any Node host with `npm run build && npm start` works.

To use it from anywhere (including before deploying), keep the server running at home and open it from your phone over Wi-Fi via the mobile URL shown at startup.

## Data & privacy

- `data/classroom.json` — synced/imported courses, assignments, cached briefing and study kits.
- `data/google-auth.json` — only if you use the optional OAuth path.
- `.env` — keys, tokens, cookies; never committed.

Passwords and tokens are never sent to any AI model — only course names, titles, due dates and points are.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Run the production server (port 8790). |
| `npm run dev` | Server + Vite with hot reload. |
| `npm run build` | Typecheck + build `dist/`. |
| `npm test` | Priority engine and formatting tests. |
| `npm run icons` | Regenerate PWA icons from the logo. |
