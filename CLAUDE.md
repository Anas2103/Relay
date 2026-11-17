# Relay — notes for Claude Code

Real-time chat app (Telegram/Discord/WhatsApp-style) with an entertainment hub and games.
Master plan: [RELAY_MASTER_PROMPT.md](RELAY_MASTER_PROMPT.md). Progress: [ROADMAP.md](ROADMAP.md) — update it as you work.

## Stack

- **Frontend:** React 19, Vite 8, Tailwind CSS 4 (`src/`), TypeScript 7 (native `tsc`)
- **Backend:** one Cloudflare Worker (`worker/index.ts`) serves the SPA and `/api/*`
- **Real-time:** Durable Objects with WebSocket hibernation — `ChatRoom` (one per conversation, `worker/room.ts`), `Lobby` (presence + sidebar updates, `worker/lobby.ts`)
- **Database:** Cloudflare D1 (SQLite), migrations in `migrations/NNNN_name.sql`
- **AI:** Workers AI binding (transcripts, translation)
- **Shared code** (client + worker): `shared/` — types, game rules (`shared/games.ts`, server is the referee), password rules, legal versions
- **Hosting:** free Cloudflare tier, `https://relay-chat.bunbunchat.workers.dev` (no custom domain). Any paid item must fit a total budget of ~100 MAD.

## Commands

| Task                      | Command                                                  |
| ------------------------- | -------------------------------------------------------- |
| Dev server (port 5173)    | `npm run db:migrate:local && npm run dev`                |
| Type check                | `npm run typecheck`                                      |
| Lint (0 warnings allowed) | `npm run lint`                                           |
| Format check / fix        | `npm run format:check` / `npm run format`                |
| Everything CI runs        | `npm run check`                                          |
| End-to-end tests          | `npm run test:e2e` (starts dev + preview servers itself) |
| Build legal pages         | `npm run legal:build`                                    |

Local secrets go in `.dev.vars` (copy `.dev.vars.example`). Production secrets: `npx wrangler secret put NAME`. Keep `.dev.vars.example` documented for every variable (this project's equivalent of `.env.example`).

## Hard rules

- **Git is read-only.** Only `git status`, `git diff`, `git log`. Never commit, push, pull, checkout, switch, branch, merge, rebase, stash, restore, reset, clean, tag, remote, or any `gh` command. Never touch `.git/`. The owner commits and pushes himself. At the end of each phase, give a suggested commit message (no AI/Claude attribution lines) and the changed-file list.
- **Never deploy** (`wrangler deploy`, `db:migrate:remote`) unless the owner asks in that session.
- **Live data is real.** The production D1 holds real users' chats. Never wipe it. Test cleanup deletes only the exact test usernames a run created.
- **No fake features:** no placeholders, dummy buttons, "coming soon", lorem ipsum or hardcoded fake data. External services are built fully behind env variables, with setup steps for the owner.
- **Branding:** copy features/UX from Discord/Telegram/WhatsApp, never their names, logos, icons, sounds or exact colors. Game names original or generic.
- **Legal media sources only** (official APIs, no scraping).
- **Stack changes:** explain why and ask first. Don't move the database off D1.

## How to work

- Use the **frontend-design** skill before any UI/design work.
- Verify UI in a real browser with Playwright at **1440px and 390px**, light and dark; test real-time features with **two browser contexts**. (Playwright MCP isn't connected in every session — the repo's own `@playwright/test` works: see `tests/helpers.ts` for `signUp`, `openFriendChat`.)
- Check current library docs before using an API you're unsure of.
- Run `/security-review` at the end of each phase; `simplify` / `code-review` for cleanup.
- Follow the phase workflow in RELAY_MASTER_PROMPT.md §5 and stop for "continue" after each phase.

## Code map (the big files)

- `src/components/ChatPane.tsx` (~2k lines), `SettingsDialog.tsx` (~2.2k), `src/lib/calls.ts` (~1.4k), `CallScreen.tsx`, `Sidebar.tsx`, `Composer.tsx`, `MessageBubble.tsx`
- `src/components/ui.tsx` — Logo, Avatar, Spinner and all hand-drawn SVG icons
- `src/index.css` — Tailwind `@theme` + theme palettes (re-tinted `zinc` scale per theme)
- `src/components/games/` — solo games (lazy-loaded from `GamesHub.tsx`); chat games in `GameCard.tsx`, `GameDialog.tsx`, `TeamGames.tsx`
- `src/components/Chill.tsx`, `src/components/chill/` — Shorts, Music, Radio, Podcasts, Fun; global player `src/lib/music.ts`
- `worker/` — `auth.ts` (PBKDF2 + session cookie), `security.ts` (2FA, devices, rate limits), `rooms.ts`, `messages.ts`, `media.ts`, `admin.ts`, `owner.ts`, `chill.ts` + `fun.ts` (media API proxies), `consent.ts` (terms/age)
- Docs: `docs/` (architecture, database, security, ADRs)
