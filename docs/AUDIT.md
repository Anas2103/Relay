# Relay audit

Audit of the `production-hardening` branch, started 2026-11-17. "Fixed" items were changed on this branch; everything else is still open.

## What Relay is

A real-time chat web app in the spirit of Telegram and Discord, built and run by one person (Hardouch Anas) for friends and as a portfolio project. Accounts are username + password only: no email or phone number. It runs entirely on Cloudflare's free tier: one Worker serves the React app and the API, Durable Objects handle live chats and presence, D1 (SQLite) stores data.

## Stack

| Part          | Technology                                                                  | Version        |
| ------------- | --------------------------------------------------------------------------- | -------------- |
| UI            | React, Tailwind CSS, Vite                                                   | 19.3, 4.3, 8.3 |
| Language      | TypeScript (native compiler)                                                | 7.0            |
| Server        | Cloudflare Workers, Durable Objects (WebSocket hibernation), D1, Workers AI | wrangler 4.160 |
| Tests         | Playwright (+ axe-core)                                                     | 1.65           |
| Lint / format | oxlint, Prettier (added on this branch)                                     | 1.94, 3.10     |

`npm audit`: **0 known vulnerabilities**. Outdated (patch/minor only): wrangler, @cloudflare/vite-plugin, workers-types, qrcode-generator. Dependabot now proposes updates weekly.

## Features that raise the safety bar

| Involves               | Features                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| Strangers interacting  | Search by username, friend requests, group invite links                |
| Messaging              | 1:1 chats, groups, secret (E2EE) chats, calls, stories                 |
| User-generated content | Text, photos, videos, voice notes, documents, stickers, stories, polls |
| Media uploads          | Avatars, chat media, stickers, stories                                 |
| Location               | Optional "share location" in a chat                                    |
| Personal data          | Profile, date of birth (new), devices with approximate city, presence  |
| Payments               | None                                                                   |

Because of messaging between people who may not know each other, the minimum age was set to **16** (see [AGE_AND_SAFETY.md](AGE_AND_SAFETY.md)).

## Baseline measurements (before this branch)

| Measurement                            | Result                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Lighthouse, live site, mobile          | Performance 97 · Accessibility 100 · Best Practices 96 · SEO 91                                                             |
| Core Web Vitals (lab)                  | LCP 2.2 s · CLS 0 · TBT 30 ms                                                                                               |
| Main JS chunk                          | 327 kB (uncompressed)                                                                                                       |
| axe (WCAG 2.2 AA) on signed-in screens | 4 rule failures: color contrast in light mode (list times, previews, timestamps, avatar initials), 20 px "add story" button |
| Typecheck / build / e2e                | Pass (55 tests)                                                                                                             |
| Lint / format                          | Not set up                                                                                                                  |

## Findings

### Critical

- **Privacy/Legal:** no Terms, Privacy Policy, age check or terms acceptance. **Fixed**: legal pages, server-side age gate (16+), terms acceptance stored with version and time, re-consent screen.

### High

- **Bug:** `Permissions-Policy: geolocation=()` in `public/_headers` blocked "Share location" on the live site (tests use the dev server, which ignores `_headers`). **Fixed**: `geolocation=(self)`.
- **Bug:** the service worker cached _every_ page as the app shell, so after opening a legal page Relay would open as that page while offline (`public/sw.js`). **Fixed**: static pages are cached under their own URL.
- **Privacy:** data export lacked devices, blocks, stories, birth date and terms acceptance (`worker/features.ts`). **Fixed**.
- **Privacy:** rate-limit rows (keyed by IP address) and expired sessions were never deleted. **Fixed**: daily purge (`purgeStaleRecords` in `worker/index.ts`).
- **Accessibility:** contrast failures and an undersized target (see baseline). **Fixed**; now enforced by `tests/a11y.spec.ts`.

### Medium

- **Code quality:** no linter or formatter. **Fixed**: oxlint (0 warnings, enforced with `--deny-warnings`), Prettier, `.editorconfig`, `npm run check`, CI quality job.
- **Bug:** Block Drop's touch buttons were components created during render, so they remounted every frame (`src/components/games/BlockDrop.tsx`). **Fixed**.
- **Bug:** game moves used the chat-message rate limit, so fast Pair Up flips were refused with "sending messages too fast". **Fixed** (a move costs ¼ of a message).
- **UX:** sign-up inputs were 14 px (iOS zooms into them); no show/hide password. **Fixed**.
- **SEO:** generic title and description, no Open Graph image, robots.txt or sitemap. **Fixed**.
- **Docs:** no SECURITY.md, CONTRIBUTING, CHANGELOG or docs folder. **Fixed**.
- **DevOps:** no dependency update automation; CI ran no audit or bundle budget. **Fixed**.

### Low / open

- `/api/me` answers 401 for signed-out visitors, which browsers log as a console error (Lighthouse Best Practices 96). Kept: tests and suspension logic depend on the 401.
- 56 lint findings from React Compiler rules are switched off with a written reason (`.oxlintrc.json`); Relay doesn't use the React Compiler.
- Very large components: `ChatPane.tsx` (~1,900 lines), `SettingsDialog.tsx` (~2,000), `calls.ts` (~1,400). Splitting them is worthwhile but risky without more unit tests; see "What's left".
- PBKDF2-SHA256 with 100,000 iterations (the most Workers' WebCrypto allows) instead of argon2id. Argon2 would need WebAssembly; acceptable for now.
- No email at all, so no email verification or email password reset. Recovery relies on 2FA recovery codes and admins resetting passwords.
- No i18n: the UI is English only. French and Arabic (RTL) would touch every component.
- No CAPTCHA on sign-up (rate limited per IP instead).
- No `LICENSE` file: the owner must choose one.

## What's left (needs a decision or a larger change)

See the list at the end of [WORKLOG.md](WORKLOG.md).
