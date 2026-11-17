# Relay roadmap

Plan: [RELAY_MASTER_PROMPT.md](RELAY_MASTER_PROMPT.md). Rules and commands: [CLAUDE.md](CLAUDE.md).

Legend: `[x]` done · `[~]` exists but must be reworked to meet the phase's bar · `[ ]` to build.
"Exists" items were checked against the code and README on 2026-11-17; they still get re-verified (and restyled/translated) in their phase.

**Current status:** Kickoff done and decisions answered (2026-11-17). Next: Phase 1, starting with the visual-direction proposal for owner approval.

---

## Open decisions (owner)

Answered by the owner on 2026-11-17:

- [x] **D1 — Auth library: YES, Better Auth** (Workers + D1). Keep existing users' PBKDF2 hashes via a custom verifier; everyone is signed out once.
- [x] **D2 — Email: SKIP.** No domain, so no email verification, magic links or email password reset. Sign-in = username/password + Google/GitHub/Discord OAuth (+ SMS OTP behind an off-by-default flag). Recovery = 2FA recovery codes + admin reset + a linked OAuth provider. Account linking uses the provider's verified email, never email we send.
- [x] **D3 — Music: BOTH.** Jamendo (CC, full features) + the existing mainstream iTunes → YouTube search.
- [x] **D4 — Shorts: R2, as long as it stays free.** Enforce hard limits so usage stays under the free tier (10 GB storage, 1M writes/10M reads a month): per-user and global storage caps, size/duration limits, old shorts expire. The YouTube Shorts tab stays as a second source.
- [x] **D5 — Commit first:** owner commits the current work before Phase 1.

---

## Phase 0 — Kickoff

- [x] Explore codebase, report stack / features / problems
- [x] `ROADMAP.md`, `CLAUDE.md`, `RELAY_MASTER_PROMPT.md` at project root
- [x] Baseline: typecheck, lint, format pass; e2e 61/62 pass (fails: `a11y.spec.ts` — contrast of the inactive "Sign in / Sign up" tab; fixed by the Phase 1 auth redesign)

## Phase 1 — Design system & "not vibe coded" foundation

- [ ] Propose an original visual direction (3–4 lines) → **owner approval**
- [ ] Design tokens in one file: color roles, spacing, radius, shadow, type scale, z-index, motion; replace raw `zinc-*`/hex/magic numbers app-wide
- [~] Themes: dark / light / system + accent (exists, with many palettes — rebuild on the new tokens, prune the ones that don't fit)
- [ ] One icon library (replace hand-drawn SVGs in `ui.tsx`) and remove emojis used as UI icons (Chill tabs, games hub, buttons)
- [ ] One font pairing, self-hosted (Inter is declared but never loaded today)
- [ ] Component kit: button, input, select, checkbox, switch, modal, drawer, dropdown, tooltip, toast, tabs, avatar+presence, badge, skeleton, empty state, error state, context menu, popover
- [ ] Loading / empty / error states on every screen
- [ ] Motion system + `prefers-reduced-motion`
- [~] Responsive: desktop rail | list | chat (+ side panel), tablet, phone bottom nav (exists) + swipe gestures (to add)
- [~] Accessibility: keyboard nav, focus rings, ARIA, AA contrast (axe test exists; extend to new screens)
- [ ] i18n framework + FR / EN / AR, full RTL (logical CSS properties), language switcher
- [ ] Remove clichés: default indigo `#4f46e5`, centered-everything auth screen, emoji tiles
- [ ] Playwright screenshots 1440/390 × light/dark × EN/FR/AR

## Phase 2 — Authentication & accounts

- [ ] Auth library (D1) with migration of existing accounts (no one loses access)
- [~] Username + password (exists; email verification and magic link dropped per D2)
- [ ] Google OAuth · GitHub OAuth · Discord OAuth (+ setup steps for each, local + prod redirect URLs)
- [ ] Phone/SMS OTP behind env flag, off by default
- [ ] Account linking by verified email; link/unlink in settings
- [ ] Forgot password without email (recovery codes / linked OAuth), change password
- [~] Password rules + strength meter (exist)
- [x] 2FA TOTP + recovery codes (exists — port onto the auth library)
- [x] Devices list, sign out one / all (exists — port)
- [ ] Onboarding flow: username, display name, avatar, bio, language, theme
- [x] Account deletion + JSON export (exist — extend with new data)
- [x] Age gate (16+) + terms checkbox with versioning (exist)
- [~] Hashing: PBKDF2-SHA256 100k (Workers limit) → evaluate argon2id via WASM
- [~] CSRF (SameSite=Lax cookie + checks), rate limiting, lockout (exist — re-audit)

## Phase 3 — Core chat

Exists: DMs, groups, invite links, WebSockets, edit, delete for everyone, reply, forward, reactions, mentions, pin, markdown + code blocks, link previews, context menu, images/videos/files, voice messages (waveform, speed, transcripts), drag & drop, paste, upload progress, typing, presence (online/DND/invisible), last seen + privacy, read receipts, unread counts + divider, message search with filters, polls, scheduled messages, saved messages, starred, disappearing messages, stories, friend requests, block, mute, archive, pin chats, fixed folders, push notifications, sounds, Ctrl+K switcher, secret (E2EE) chats.

- [ ] **Spaces** (servers): text channels, categories, roles & permissions, member list, settings
- [ ] Invite links with expiry + usage limits (groups have reset/off only)
- [ ] Broadcast **channels** (one-to-many)
- [ ] Threads
- [ ] Edit history ("edited" label + view history); delete for me
- [ ] @role and @everyone mentions
- [ ] Full emoji picker for reactions and composer
- [ ] Syntax highlighting in code blocks
- [ ] Image gallery in lightbox (swipe between chat photos)
- [ ] GIFs via official API (Tenor/GIPHY, key in env); custom emoji per Space
- [ ] Idle presence state; "delivered" vs "read" receipts + read-receipt privacy toggle
- [ ] Message list virtualization; jump to first unread
- [ ] Search syntax `from:` `has:file|image|link` `before:/after:`
- [ ] Story viewer list + per-story privacy (check existing)
- [ ] Custom chat folders (Telegram-style, user-defined)
- [ ] Per-chat notification settings page
- [ ] Keyboard shortcuts help modal; Ctrl+K → full command palette (actions, not only chats)

## Phase 4 — Voice & video

Exists: 1:1 voice/video, screen share with audio, mute/camera, speaking indicator, device selection, ringing, missed-call messages, call history in chat, STUN + optional Cloudflare TURN.

- [ ] Group voice/video calls (SFU needed beyond ~4 people: Cloudflare Realtime SFU or mesh limit — decide in phase)
- [ ] Voice channels inside Spaces (drop-in/drop-out, who's-in list)
- [ ] Global call history screen
- [ ] TURN production setup docs (free/cheap options) in `.dev.vars.example`

## Phase 5 — Entertainment

Exists: Chill view with Shorts (YouTube), Music (iTunes → YouTube), Radio (Radio Browser), Podcasts (iTunes + RSS), global player with Media Session, mini-player, podcast speed/resume.

- [ ] Rename/rework as an "Entertainment" area: Music · Podcasts · Radio · Shorts tabs
- [ ] Player: full-screen view, queue reorder/remove, repeat one/all, shuffle, sleep timer, remember position
- [ ] Music (D3): browse genre/mood, trending, search, artist + album pages, likes, playlists (create/edit/share to chat), recently played
- [ ] Podcasts: subscriptions, new-episodes feed, mark played (resume exists)
- [ ] Radio: Morocco first, browse by country/genre/language, favorites, now-playing, dead-stream auto-skip + message
- [ ] Shorts (D4): user upload with limits, vertical swipe feed, muted autoplay, likes, comments, share, creator profile, report + moderation
- [ ] Rich share cards in chat that play inline (song, episode, station, short)
- [ ] Playwright: real playback verified for each source

## Phase 6 — Games

Exists — solo (17): Word Guess, Sudoku, 2048, Minesweeper, Sliding Puzzle, Hangman, Memory, Block Drop, Snake, Brick Breaker, Sky Hop, Trivia, Math Sprint, Color Echo, Reaction, Typing (+ hub). Chat (vs friends, server-refereed): Tic-tac-toe, Connect Four, Checkers, Five in a Row, Reversi, Mancala, Dots & Boxes, Hangman Duel, RPS; team: Word Team, Crack the Code, Pair Up; Watch Together. Only 2–3 solo games have difficulty levels; no vs-AI mode.

- [ ] Games hub: cover art, categories, search, favorites, recently played, invite-from-chat card
- [ ] All existing games: polish, sounds + mute, how-to-play, Facile/Normal/Difficile/Expert, options, pause/restart/undo
- [ ] Rename "2048" to an original name
- [ ] Vs-AI for every versus game (minimax + alpha-beta on hard levels)
- [ ] New solo: solitaire, nonogram, (others in master list already exist)
- [ ] New versus: chess with clocks, battleship, pong, Ronda, dominoes, ludo; tic-tac-toe 3×3–5×5
- [ ] New co-op/party (2–8): draw & guess, quiz battle (FR/EN/AR), co-op puzzle, word chain, find-the-spy, shared whiteboard, co-op defense, original card party game, + more
- [ ] Multiplayer infra: rooms outside chats, invite links, spectators, reconnect, turn timers, rematch, in-game chat
- [ ] Progression: stats, leaderboards (global + friends), achievements on profiles, match history (move from localStorage to D1)
- [ ] Touch controls + responsive check for every game

## Phase 7 — Profiles, settings, safety & moderation

Exists: avatar, bio, custom status, many settings, report messages/people, block, rate limits, admin + owner dashboards, reports queue, suspend, audit log, stats.

- [ ] Profile banner, badges, game stats, mutual friends/Spaces
- [ ] Settings reorganized into the master list's sections (+ Connected accounts, Accessibility, Data & storage)
- [ ] Privacy: who can DM / add me / see stories
- [ ] Report shorts; optional profanity filter
- [ ] Dashboard: content deletion for shorts/Spaces, ban vs suspend

## Phase 8 — Legal & compliance

Exists (EN only): Terms, Privacy, Cookies, Guidelines, Accessibility, Help pages; age gate; versioned terms acceptance with re-consent screen.

- [ ] All pages in FR / EN / AR with "last updated"
- [ ] Privacy policy: Law 09-08 (CNDP) + GDPR, every third party added in phases 2–6, owner-access disclosure
- [ ] Cookie consent banner (accept / reject / customize) actually enforced
- [ ] Copyright/takedown policy + takedown request form
- [ ] Mentions légales
- [ ] Links in footer, sign-up and settings
- [ ] Owner told: drafts to be reviewed by a legal professional

## Phase 9 — Final polish & production

- [ ] Lighthouse ≥ 90 on all four (baseline: 97 / 100 / 96 / 91)
- [~] PWA (exists) + offline page
- [ ] Landing page (original) + SEO + Open Graph
- [ ] 404 / 500 pages, error monitoring hooks, structured logging
- [ ] Unit tests (none today), integration tests, full e2e journey list
- [ ] Final screenshot review: every page × desktop/mobile × light/dark × FR/AR
- [ ] README rewrite; fix broken `docs/WORKLOG.md` link
