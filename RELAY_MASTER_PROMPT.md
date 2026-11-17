# RELAY — Master Build Instructions

> **How to use this file:** put it at the root of the Relay project, then tell Claude Code:
> `Read RELAY_MASTER_PROMPT.md fully and follow it. Start with section 3 (Kickoff).`
> To resume in a new session: `Read RELAY_MASTER_PROMPT.md and ROADMAP.md, then continue from where you stopped. Same rules.`

---

## 1. The vision (what the owner asked for)

Relay must become **the ultimate chat application**: a real, complete chat platform that combines the best of **Discord + Telegram + WhatsApp**, plus an **Entertainment hub** (Music, Podcasts, Radio, Shorts) and a **huge Games section** with co-op multiplayer.

Owner's explicit requirements — every one of these must be delivered:

1. The website must **not look vibe coded / AI-generated**. It must look like it was designed and built by a professional product team.
2. **All the legal pages and compliance** needed for a real public app.
3. **Google authentication** plus **multiple sign-up and login options**.
4. A **real chatting app** like Discord, Telegram and WhatsApp — copying their features and UX is allowed and encouraged (but not their branding, see rules).
5. **Entertainment** section with **Music, Podcasts, Radio and Shorts each in their own tab**.
6. **Music, Podcasts and Radio must work perfectly** (real playback, real sources, tested).
7. **Shorts** must work perfectly too.
8. **Many games**, with a polished **games UI**.
9. **More options and harder difficulty levels for ALL games** (existing and new).
10. **More co-op / multiplayer games**.
11. **Anything else that is possible to add** to make it the most complete chat platform.
12. Claude Code may do **anything it needs EXCEPT touch the GitHub repo / git**. The owner commits and pushes himself.

---

## 2. Hard rules (never break these)

### 2.1 Git is off-limits

- Never run: `git commit`, `push`, `pull`, `reset`, `checkout`, `switch`, `branch`, `merge`, `rebase`, `stash`, `restore`, `clean`, `tag`, `remote`, or any `gh` command.
- Never modify the `.git` folder.
- Allowed (read-only): `git status`, `git diff`, `git log`.
- At the end of every phase, give the owner a **suggested commit message** and the list of changed files.

### 2.2 Everything else is allowed

Install packages, create/edit/delete/refactor files, run the dev server, run migrations, scripts, builds and tests.

### 2.3 Branding & copyright

- Copy **features and UX patterns** from Discord, Telegram, WhatsApp freely.
- **Never** copy their names, logos, icons, sounds, mascots, illustrations or exact brand colors. Relay has its **own original identity**.
- Game names must be **original or generic** (no "Tetris", "UNO", "Scrabble", "Pictionary", "Among Us", etc.).
- Only **legal content sources** for media. No scraping, no pirated content, no unofficial/reverse-engineered APIs.

### 2.4 No fake features

- No dummy buttons, no "coming soon", no lorem ipsum, no hardcoded fake users/messages/data in production code.
- If a feature needs an external account, API key or payment (Google OAuth, SMS, TURN server, GIF API, music API…): build it **fully** behind environment variables and give the owner **exact step-by-step setup instructions**.

### 2.5 Secrets

- Secrets live only in `.env`. Never hardcode them, never print them.
- Keep `.env.example` up to date with every variable + a comment explaining what it is and where to get it.

### 2.6 Stack

- Keep Relay's existing stack unless something is truly blocking. If a change is needed, **explain why and ask first**.
- Do not migrate the database to a different provider (e.g. Neon) unless the owner asks.

---

## 3. Kickoff (do this first)

1. Explore the **whole codebase**: structure, stack, routes, models/schema, existing features, existing games, existing entertainment features, auth, styling.
2. Report to the owner: current stack, what exists, what's broken, what looks "vibe coded", and the biggest weaknesses.
3. Create **`ROADMAP.md`** at the project root: every phase below broken into checkbox tasks. Keep it updated as you work so any new session can resume.
4. Create or update **`CLAUDE.md`**: stack, how to run dev/tests/lint, the git rules, "use the frontend-design skill for all UI work", "verify UI with Playwright at 1440px and 390px".
5. Show the owner the report + ROADMAP, then **wait for "continue"**, then start Phase 1.

---

## 4. Tools to use

These are installed and must be used:

| Tool                           | Use it for                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **frontend-design** skill      | Every UI/design decision, before writing UI code                                                                            |
| **Playwright MCP**             | Open Relay in a real browser, click through features, screenshots at 1440px & 390px, test real-time with 2 browser contexts |
| **webapp-testing** skill       | Structured testing of the running web app                                                                                   |
| **Context7 MCP**               | Up-to-date docs for every library/framework used — check docs before using an API                                           |
| **/security-review**           | After every phase                                                                                                           |
| **code-review** / **simplify** | Clean up code at the end of each phase                                                                                      |

---

## 5. Workflow for every phase

1. Plan the phase in ROADMAP.md.
2. Build it completely (no placeholders).
3. Run lint, type checks, tests — fix everything.
4. Run the app and verify with **Playwright**: click through every new feature, screenshots at **desktop 1440px** and **mobile 390px**, **light + dark** mode. Real-time features tested with **two users in two browser contexts**.
5. Run a **security review** of the new code and fix issues.
6. Report to the owner: what was built, files changed, what he must set up manually (step by step), suggested commit message.
7. **STOP and wait for "continue".**

---

## 6. Phases

### PHASE 1 — Design system & "not vibe coded" foundation

- Choose a **distinctive, original visual direction** for Relay. Explain it to the owner in 3–4 lines and **wait for approval** before applying it.
- **Design tokens** in one place: colors, spacing scale, radius, shadows, typography scale, z-index, motion durations. Used everywhere, no magic numbers.
- Themes: **dark, light, system**, plus accent color choice.
- **One icon library** (no emojis as UI icons). **One font pairing.**
- Reusable components: buttons, inputs, selects, checkboxes, switches, modals, drawers, dropdowns, tooltips, toasts, tabs, avatars (with presence dot), badges, skeleton loaders, empty states, error states, context menus (right-click), popovers.
- Every screen has real **loading, empty and error states**.
- Subtle, consistent animations; respect `prefers-reduced-motion`.
- **Fully responsive**: desktop 3-column layout (nav/spaces | conversations | chat + optional side panel), tablet, mobile with bottom navigation and swipe gestures.
- **Accessibility**: keyboard navigation, visible focus rings, ARIA labels, WCAG AA contrast, screen-reader-friendly messages.
- **Languages**: French, English, Arabic — with full **RTL** layout support and a language switcher.
- Remove all AI-generated design clichés: generic purple/blue gradients, oversized hero sections, random glassmorphism, inconsistent spacing, everything centered, generic stock illustrations, fake testimonials.

### PHASE 2 — Authentication & accounts

- Use a **proven, maintained auth library** for the stack. No hand-rolled auth.
- Sign up / log in with:
  - Email + password (with **email verification**)
  - **Google OAuth**
  - **GitHub OAuth**
  - **Discord OAuth**
  - **Magic link** (passwordless email)
  - Phone/SMS OTP — **behind an env flag, disabled by default** (costs money)
- **Account linking**: same email → one account; link/unlink providers in settings.
- Forgot/reset password, change email, change password, strong password rules, strength meter.
- **Two-factor authentication** (TOTP app + backup codes).
- **Active sessions/devices** list: log out one device / log out everywhere.
- **Onboarding** after first sign up: unique validated username, display name, avatar, bio, language, theme.
- **Account deletion** and **full personal-data export** (JSON) from settings.
- **Age confirmation** at sign up (minimum age per legal pages) + **"I accept the Terms & Privacy Policy" checkbox** with terms versioning.
- Security: argon2/bcrypt hashing, CSRF protection, **rate limiting** on auth routes, login backoff/lockout, secure httpOnly cookies, input validation everywhere.
- Give the owner exact step-by-step instructions to create the **Google, GitHub and Discord OAuth apps** with correct redirect URLs for local and production.

### PHASE 3 — Core chat (real-time)

- Real-time via **WebSockets** (best option for the stack).
- **Direct messages**, **group chats**, and **Spaces** (Discord-like servers) with text channels, categories, **roles & permissions**, **invite links** (expiry + usage limits), member list, Space settings.
- Telegram-like **channels** (broadcast, one-to-many) as an option.
- **Messages**: send, edit (with "edited" label + history), delete (for me / for everyone), reply/quote, forward, **reactions** (emoji picker), **mentions** (@user, @role, @everyone), **threads**, **pin**, markdown formatting, code blocks with syntax highlighting, **link previews**, copy text, message context menu.
- **Media**: images (lightbox + gallery), videos, files, **voice messages** (record, waveform, playback speed), drag & drop, paste upload, upload progress, server-side type/size validation.
- **GIFs & stickers** via official API (Tenor or GIPHY, key in `.env`); custom emoji per Space.
- **Typing indicators**, presence (online / idle / do not disturb / invisible), **last seen** (privacy toggle), **delivered/read receipts** (privacy toggle).
- **Unread counts**, jump to first unread, **infinite scroll with virtualization**, **message search** (text, user, date, has:file/image/link).
- **Polls**, **scheduled messages**, **saved messages / bookmarks**, **disappearing messages** (per-chat timer).
- **Stories / Status** (24h, WhatsApp/Telegram style) with viewers list and privacy.
- **Friends/contacts**: friend requests, block, mute, **archive**, **pin chats**, **chat folders** (Telegram-style).
- **Notifications**: in-app, browser push (Web Push), sounds, per-chat mute, notification settings.
- **Keyboard shortcuts** (+ help modal) and **command palette** (Ctrl/Cmd+K).

### PHASE 4 — Voice & video

- 1-to-1 and group **voice/video calls** with WebRTC.
- Discord-style **voice channels** inside Spaces.
- Mute, camera toggle, **screen sharing**, speaking indicator, device selection (mic/camera/speaker), ringing UI, missed-call messages, **call history**.
- Works locally with STUN. Explain clearly that production needs a **TURN server**, list free/cheap options, configure via `.env`.

### PHASE 5 — Entertainment (Music, Podcasts, Radio, Shorts — each in its own tab)

**Global player** (shared by Music, Podcasts, Radio):

- Persistent **mini-player** that keeps playing across the whole app (chat, games, settings); expandable full-screen player.
- Play/pause, next/previous, seek bar, volume, **shuffle**, **repeat** (off/all/one), **queue** (add, reorder, remove), **playback speed** (podcasts), **sleep timer**, remembers position.
- Media keys + **Media Session API** (lock screen / OS controls).

**Music tab** — legal source only (e.g. **Jamendo API**, Creative Commons, key in `.env`):

- Browse by genre/mood, search, trending, artist & album pages, likes, **user playlists** (create/edit/share to chat), recently played.

**Podcasts tab** — **iTunes Search API** and/or **Podcast Index API**, play episodes from official RSS audio:

- Search, subscribe, new-episodes feed, **resume where you left off**, mark as played.

**Radio tab** — **Radio Browser API**:

- Browse by country (**Morocco first by default**), genre, language; search; favorites; "now playing" when available; dead streams handled gracefully (auto-skip + message).

**Shorts tab** — vertical feed of **user-uploaded** short videos:

- Upload with size/duration limits, swipe/scroll navigation, autoplay muted with tap to unmute, likes, comments, share to chat, creator profile, **report** button, moderation hooks.

**Sharing**: any song / episode / station / short can be shared into a chat as a rich card that plays inline.

**Must work perfectly**: actually play audio from each source and verify with Playwright. No broken streams shown to the user without a clear message.

### PHASE 6 — Games

**Games hub**: library grid with cover art, categories, search, favorites, recently played. **Invite friends to a game from any chat** (game invite card in the conversation).

**Improve ALL existing games first:**

- Polished UI, animations, sounds (with mute), how-to-play tutorial.
- **Difficulty levels: Facile / Normal / Difficile / Expert** (and harder where it makes sense).
- **More options**: board sizes, timers, rule variants, themes.
- Pause / restart / undo where relevant.
- **Smart AI** on hard levels (e.g. minimax with alpha-beta pruning, heuristics).

**Add many new games** (original names, all with difficulty levels and options):

- **Solo**: block-stacking puzzle, snake, 2048-style, minesweeper, sudoku, memory cards, word puzzle, typing speed test, breakout, flappy-style, solitaire, nonogram.
- **Versus (vs AI and online vs friends)**: tic-tac-toe (3×3 to 5×5), connect four, chess (with clocks), checkers, battleship, dots and boxes, reversi, pong, **Ronda** (Moroccan card game), dominoes, ludo.
- **Co-op & party (real-time, 2–8 players)**: drawing & guessing, trivia/quiz battle (categories + difficulty, FR/EN/AR), co-op puzzle challenges, word chain, "find the spy" party game, shared whiteboard, co-op survival/defense mini-game, card party game (original rules and name).
- Add **more** co-op and multiplayer games beyond this list wherever possible.

**Multiplayer**: real-time rooms, invite links, spectators, reconnect after disconnect, turn timers, rematch, in-game chat.

**Progression**: per-game stats, leaderboards (global + friends), **achievements/badges** shown on profiles, match history.

Every game: fully playable, bug-free, responsive, **touch controls on mobile**.

### PHASE 7 — Profiles, settings, safety & moderation

- **Profiles**: banner, avatar, bio, custom status, badges, game stats, mutual friends/Spaces.
- **Settings**: Account, Privacy (who can DM / add me / see last seen / read receipts / see stories), Security (2FA, sessions), Notifications, Appearance (theme, accent, font size, compact mode), Language, Chats, Data & storage, Accessibility, Connected accounts.
- **Safety**: report users/messages/shorts, block, spam protection & rate limits, optional profanity filter.
- **Admin/moderator dashboard**: reports queue, ban/suspend, delete content, audit log, basic stats.

### PHASE 8 — Legal & compliance

Professional pages in **French, English and Arabic**, linked in the footer, at sign up and in settings:

- **Conditions Générales d'Utilisation** (Terms of Service)
- **Politique de Confidentialité** (Privacy Policy) — compliant with **Moroccan Law 09-08 (CNDP)** and the **GDPR**: data collected, purpose, retention, third parties (Google, GitHub, Discord, Jamendo, Radio Browser, podcast APIs, Tenor/GIPHY, hosting…), user rights, contact
- **Politique des Cookies** + real **cookie consent banner** (accept / reject / customize — consent actually enforced)
- **Règles de la communauté** (Community Guidelines)
- **Copyright / takedown policy** + takedown request form
- **Mentions légales** (legal notice)
- **Minimum age** requirement enforced at sign up
- Terms acceptance with **versioning** (re-accept on change)
- Every page shows a **"last updated"** date.
- Tell the owner clearly: these are **drafts to be reviewed by a legal professional** before public launch.

### PHASE 9 — Final polish & production readiness

- **Performance**: code splitting, lazy loading, image optimization, caching, DB indexes, pagination everywhere. **Lighthouse ≥ 90** on performance, accessibility, best practices, SEO.
- **PWA**: installable, app icons, offline page.
- **Landing page** that showcases Relay (original, not template-looking) + SEO + Open Graph meta.
- Custom **404 / 500** pages, error monitoring hooks, structured logging.
- **Tests**: unit (core logic), integration (auth, messaging), end-to-end Playwright (sign up, send message, call UI, play music/podcast/radio, upload/watch a short, play a multiplayer game).
- **Final visual review**: Playwright screenshots of **every page** at desktop and mobile, light and dark, French and Arabic (RTL). Fix every inconsistency.
- Clean **README**: features, stack, setup, env variables, run, test, deploy.

---

## 7. Definition of done (checked before saying a phase is finished)

- [ ] No placeholders, no fake data, no "coming soon"
- [ ] Lint, type checks and tests pass
- [ ] Verified in the browser with Playwright (desktop + mobile, light + dark)
- [ ] Real-time features tested with two users
- [ ] Loading, empty and error states exist
- [ ] Works in FR, EN and AR (RTL)
- [ ] Keyboard accessible
- [ ] Security review done, issues fixed
- [ ] `.env.example` updated
- [ ] ROADMAP.md updated
- [ ] Report + manual setup steps + suggested commit message given to the owner
- [ ] No git write commands were run
