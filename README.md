# Relay

[![CI](https://github.com/Anas2103/Relay/actions/workflows/ci.yml/badge.svg)](https://github.com/Anas2103/Relay/actions/workflows/ci.yml)

Real-time chat in the spirit of Telegram: groups, **end-to-end encrypted secret chats**, voice & video calls, voice notes, photos, videos, documents, view-once media, Saved Messages and deep customization. Installable as an app, and running entirely on Cloudflare's free tier.

**Live demo:** https://relay-chat.bunbunchat.workers.dev

## Features

**Account security**

- **Two-step verification** (TOTP, works with any authenticator app) with 8 one-time recovery codes, stored hashed. Codes can't be replayed, and five wrong codes end the sign-in attempt
- **Devices list** like Telegram's: browser, OS, approximate city and last activity for every sign-in. Sign out one device or all others, and the device is disconnected live, straight away
- **Automatic sign-out** of devices unused for 1 week to 1 year, plus **new sign-in alerts** on your open devices
- **Passcode lock** (PIN, PBKDF2-hashed, device-only) with auto-lock and an increasing wait after wrong tries
- Password rules shared by client and server (common passwords and passwords containing your username are refused) with a live strength meter
- Strict security headers on every page and API response (CSP, HSTS preload, frame-ancestors none, COOP/CORP, no-referrer)

**Telegram & Discord-style chatting**

- Formatting: **bold**, _italic_, **underline**, ~~strike~~, `code`, code blocks, > quotes and ||spoilers|| (rendered as React elements, never HTML). Ctrl/⌘+B, I, U, E, Shift+X, Shift+S shortcuts
- **@mentions** with suggestions; mentions and replies to you alert you even in muted chats, with an @ badge in the chat list
- **Polls** (single or multiple answer), **multi-select** (copy, forward, delete), per-chat **drafts**, **send without sound**
- Groups: **invite links** (reset or turn off), **announcement mode** (only admins post), **slow mode**
- **Custom status** and **Do Not Disturb / Invisible** presence
- **Ctrl/⌘+K quick switcher** and Alt+↑/↓ to move between chats
- **Scheduled messages**, kept and sent by the chat's own server even when your device is off
- **Search across all your chats** (never secret chats), jumping straight to the message. In a chat, **filter** by type (photos & videos, files, links, voice), by person and by date, with or without words
- **Stickers**: your own collection (up to 120, synced to your account), made from any picture or from a photo in a chat ("Add to stickers"); transparent cut-outs stay transparent, shown big without a bubble
- **Share your location** (after a preview you confirm), drawn as a small map without loading third-party map tiles, so nobody outside the chat learns who looked; "Open in Maps" on any device
- **Remind me** about any message (in 20 minutes, tonight, tomorrow, next Monday or any time): a reminder lands in Saved Messages with a notification, even if Relay is closed
- **"Seen by"** in groups, an **"Unread messages"** divider, **group photos** and a shareable **profile link** (`/?u=username`)

**Layout**

- Desktop: a **rail on the far left** like Discord's server list (home, shortcuts to pinned and unread chats with unread pills, new group, Chill, games, settings), the chat list, and the chat, edge to edge. A user panel at the bottom of the list shows your status
- Phones: a **bottom tab bar** like Telegram's (Chats with an unread badge, Chill, Games, Settings)

**Chat themes (like Instagram)**

- Give any chat one of 20 themes. It's **shared**: everyone in the chat sees it, switches to it live, and gets a "changed the theme" notice
- Gradient themes span the screen, so each bubble shows its own slice of the gradient as you scroll
- Themes are checked by the server (only known ones are stored); in announcement groups only admins can change them. Anyone can turn off "Show chat themes" to always keep their own look

**Play together in any chat**

- **Team games** where the whole chat plays against the puzzle: **Word Team** (guess a 5-letter word together in 6 tries), **Crack the Code** (find 4 hidden colors in 10 tries), **Pair Up** (a shared memory board with a miss limit and a "who found what" scoreboard)
- **Head to head**: Tic-tac-toe, Connect Four, Checkers (forced captures, multi-jumps, kings), Five in a Row, **Reversi**, **Mancala**, Dots & Boxes, Hangman Duel, Rock paper scissors (best of 3)
- **Watch together**: a YouTube video kept in sync for everyone
- The server is the referee: every move goes through the shared rules in `shared/games.ts`, moves on one game are serialized, and hidden information (the secret word, the code, face-down cards, rock-paper-scissors picks) never leaves the server until it's revealed

**Chill**

- Music (real catalog via Apple's search, played from the official video), YouTube Shorts, live radio, podcasts, jokes and trivia, plus 16 solo games with best scores. Music keeps playing while you chat

**Moderation**

- **Report** a message or a person; the reported text is copied at the time, so deleting it afterwards doesn't hide it. In secret chats, the reporter chooses to share the decrypted text
- Admins get a **Reports** tab (resolve, dismiss, suspend), with every action in the audit log
- Group admins can **remove and ban** (invite links won't let a banned person back in) and manage the ban list

**Secret chats (end-to-end encrypted)**

- Start one from any 1:1 chat. Keys are made on your device (ECDH P-256 → HKDF-SHA256 → AES-256-GCM via WebCrypto); the private key is **non-extractable**, so not even the app's own JavaScript can read it out
- The server only ever stores ciphertext and **refuses anything else** in a secret chat (and refuses ciphertext in normal chats, so nothing can fake being private). Nobody else can read them: not the server, not admins, not the owner
- **Encrypted photos** (and view-once photos): encrypted on your device before upload, padded to hide their exact size, with size, type and caption inside the encrypted message. The server stores an opaque blob it refuses to cache, and refuses plain photos in a secret chat. Decrypted copies live only in the open tab's memory
- Every message and photo is bound to the chat **and to its sender**, so the server can't pass one person's message off as the other's
- **Ending a secret chat erases it everywhere**: messages and photo files are deleted from the server, and _both_ devices destroy their keys (the other person's device does it as soon as it sees the chat is gone), so even a surviving copy could never be decrypted again
- Like Telegram: device-bound, can't be forwarded or saved as stickers, never searched, previewed or translated by the server, support disappearing messages, and signing out removes their keys from that device. "Read aloud" uses only on-device voices there
- An 8-emoji key fingerprint both people can compare to rule out a man-in-the-middle

**Telegram-style chats**

- **Groups** with admins: rename, add and remove people, promote admins, leave, delete
- **Saved Messages**: a private chat with yourself, on all your devices
- **Pin, mute (1 hour to forever), archive** chats; **folders** (All · Unread · Personal · Groups · Secret); right-click or long-press any chat
- **Pinned messages** bar, **starred** messages, **forwarding**, **link previews** (fetched by the server, so sites never see your IP), **disappearing messages** (30 s to 90 days), big emoji

**Calls**

- **Voice and video calls** over WebRTC, peer-to-peer and encrypted (DTLS-SRTP); the server only relays the setup messages
- Ringing on all your devices (stops everywhere once you answer on one), mute, camera on/off, front/back camera, minimize to keep chatting
- **AI noise suppression** running on your device (GTCRN or RNNoise in an AudioWorklet), switchable mid-call without dropping it, plus echo cancellation, gain control, a noise gate and the option to clean up the other person's voice too
- **Choose your microphone, speaker and camera** (in Settings or mid-call, without dropping the call), mic boost up to 200%, call volume up to 200% (with a limiter so it never distorts), speaker test and camera preview. Unplug a headset and the call carries on with the default mic; plug one in and Relay offers to switch to it
- **Sound output on every device**: a speaker list on computers and iPhone/iPad (Safari 18.4+), **loudspeaker / earpiece / wired / Bluetooth routes on Android**, Safari's AirPlay & Bluetooth picker and Firefox's speaker picker, plus a quick output button on the call screen. Where the page truly can't choose, it says how to switch on the device
- **Voice quality**: Opus tuned with forward error correction and full-band audio; choose Clear, Studio (up to 128 kbps, for music) or Data saver. Voice gets network priority over video. Voice isolation where the device supports it
- Works around phone quirks: call volume works on iPhones (where web volume is normally fixed), "Tap to hear the call" if a browser blocks sound or pauses audio in the background
- **Turn a voice call into a video call**, **screen sharing** (desktop), **answer without video**, video quality (Auto / HD / Data saver)
- **Floating emoji reactions**, **push-to-talk** (hold Space or the mic button), "You're muted" hint when you talk while muted, speaking indicators
- Live **connection bars** (delay, packet loss, direct or relayed), with a tip to drop video when the line gets weak
- **Decline with a message** ("I'll call you back…"), **Call again / Message** after a missed or declined call, 5 **ringtones** with volume (phones also vibrate)
- M / V / Space shortcuts, keeps the screen awake, full screen and picture-in-picture on desktop
- Call history in the chat ("Missed video call", "Voice call · 3:20"); tap to call back
- Works with free public STUN; optional Cloudflare TURN relay for restrictive networks

**Messaging**

- Real-time chat over WebSockets, with optimistic sending, retry on failure and automatic reconnect plus catch-up
- **Documents and videos** up to 20 MB, with upload progress; videos stream with byte ranges (instant seeking, iPhone-compatible)
- **Search** a whole conversation and **jump to any message**, however old (history loads around it in both directions)
- **Contact info** with Media, Files, Links and Voice tabs
- **Voice messages**: tap to record with a live waveform; playback with seek and 1× / 1.5× / 2× speed; **"Aa · Transcribe"** turns one into text (Whisper on Cloudflare Workers AI), saved so it's only ever done once
- **Translate** any message (or a voice message's transcript) into 14 languages, with the source language detected automatically. Uses the free Workers AI allowance; never for secret chats, whose text the server can't read
- **Photos**: compressed in the browser (a 4 MB photo becomes ~250 KB, with EXIF/GPS stripped), paste or drag-and-drop, captions
- **View-once photos**: each recipient can open them exactly once, enforced by the server; deleted after everyone has seen them
- Replies with quoted previews, emoji reactions, edit, delete for everyone
- Read receipts (✓ / ✓✓), typing indicators, unread badges, a "new messages" jump button

**People**

- **Message requests**: a new chat starts as a request. Until it's accepted, the sender can't message, call, send files or see when the other person is online. Declining removes it for both people
- Profile pictures, bios and a profile page
- Online status and "last seen", shared only with people you have an accepted chat with
- Instant sidebar updates, desktop notifications and message sounds for other chats

**Personalization** (synced across devices, applied before first paint)

- **Simple mode** for parents and grandparents: bigger text and buttons, roomy spacing, and the extras (folders, "Online now", pin/star/select) tucked away
- System / light / dark, with 10 light and 12 dark styles, 20 wallpapers
- App color and bubble color from a palette, 16 gradients or **any custom color** (readable text worked out automatically to WCAG AA)
- Message text size, whole-app size, 6 fonts, bubble corner roundness, spacing density, chat width, round/rounded/square avatars, 12/24-hour time, animations on/off
- Enter-to-send or Ctrl+Enter, link previews, chat-list previews, the "Online now" row
- Privacy: hide last seen (works both ways, like Telegram), hide typing, blocked list
- Your data: export everything as JSON, delete your account

**App**

- Installable (PWA) on phones and desktops, unread badge on the app icon, push notifications that never contain message content
- **Works offline**: the app's code is cached by the service worker (never anything from /api), and your chat list and recent messages are kept on the device (IndexedDB), so Relay opens and shows your chats with no signal. Messages written offline wait and go out on reconnect. Wiped on sign-out; can be turned off per device
- **Always up to date**: every build gets an id; tabs left open notice a new deploy, offer "Reload", and switch over by themselves when they're in the background and no call is on (drafts are kept)
- **Read aloud** any message with your device's own voice (Arabic and French get a matching voice)
- Layouts built for every size: bottom sheets on phones, side panels and popovers on desktop, safe areas for notches

**Admin & owner**

- **Admins** manage regular accounts: edit, reset passwords, sign out, **restrict** (read-only for a while) or **suspend for a set time with a reason** the person sees, delete
- **The owner (super admin) is the highest authority** and can do everything:
  - manage admins too (nobody else can touch admins or the owner account)
  - see any account's **devices, chats and activity**, sign out a single device, and **erase everything someone wrote**
  - review, **search across every conversation**, export and delete any chat or group, and **join any group as its admin** to moderate it from inside
  - remove anyone's story
  - run the site: announcement banner, **broadcast alerts** to every screen (and phone), sign-ups, **maintenance mode**, **read-only mode**, **switch any feature off for everyone** (calls, secret chats, stories, uploads, groups, new chats, AI), and **sign everyone out**
  - search the full audit log, where all of the above is recorded
  - Secret chats are the one thing nobody can read, the owner included: that's what end-to-end encryption means
- Live overview: who's online, messages per day (14-day chart), most active people, pending requests
- User management with filters (online, admins, suspended) and sorting: create, edit, reset password, promote, suspend, sign out everywhere, delete
- Searchable, filterable audit log of every admin action
- **Admins can manage accounts but can never read messages.** There is no endpoint, for any role, that returns message content

## Architecture

```
Browser (React + Tailwind)
   │  HTTPS  /api/*                 auth, history, uploads
   │  WSS    /api/rooms/:id/ws      live chat for the open conversation
   │  WSS    /api/lobby             presence + sidebar updates
   ▼
Cloudflare Worker ── checks session + room membership on every request
   │                     │                              │
   ▼                     ▼                              ▼
D1 (SQLite)       Durable Object "ChatRoom"       Durable Object "Lobby"
users, rooms,     one per conversation:           one for the app:
messages,         live sockets + that chat's      online status, last seen,
reactions,        photos & voice notes            "new message" events
avatars           (in its own SQLite storage)
```

- **One Durable Object per conversation** keeps everyone in that chat on the same instance, so broadcasting is just a loop over sockets. It also stores the chat's media in its built-in SQLite, so there's no separate storage service and no cost.
- **The Lobby** gives each tab one extra socket for app-wide events (presence, unread counts, notifications). Both objects use the **WebSocket Hibernation API** with auto-answered pings, so idle connections cost nothing.
- The Worker authenticates **before** forwarding anything to a Durable Object, which never handles untrusted identity.
- The React app is served from the same Worker, so everything is same-origin: no CORS, and strict cookies.

## Security

| Threat                                    | Mitigation                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password leaks                            | PBKDF2-SHA256 (100k iterations, per-user salt), constant-time compare; common passwords refused                                                                            |
| Stolen password                           | Optional two-step verification (TOTP + one-time recovery codes, replay-protected)                                                                                          |
| Stolen / forgotten device                 | Devices list with remote sign-out (live disconnect), auto sign-out of idle devices, new sign-in alerts, local passcode lock                                                |
| Clickjacking, XSS, data leaks via headers | CSP, frame-ancestors 'none', X-Frame-Options, HSTS preload, COOP/CORP, Referrer-Policy: no-referrer                                                                        |
| Username enumeration                      | Same error and same timing for unknown user vs wrong password                                                                                                              |
| Session theft from DB                     | Only SHA-256 hashes of session tokens are stored                                                                                                                           |
| XSS                                       | `HttpOnly` cookie; messages rendered as text (links built as React elements); strict CSP                                                                                   |
| Malicious uploads                         | File type detected from the bytes ("magic numbers"), not the client's claim; served with `nosniff` and a sandbox CSP; size and type metadata always come from the server   |
| Huge uploads                              | Streamed with a byte counter, so oversized files are refused without being held in memory                                                                                  |
| View-once bypass                          | Sender can't open it; each recipient gets one atomic claim (database `INSERT … ON CONFLICT DO NOTHING`); `no-store` caching; file deleted once all recipients have seen it |
| CSRF / cross-site WebSocket hijacking     | `SameSite=Lax` cookie and `Origin` check on all writes and WebSocket upgrades                                                                                              |
| Reading other people's chats or media     | Membership checked on every history, upload, download and socket request (returns 404, not 403)                                                                            |
| Brute force                               | Rate limits on login (per IP and per username), sign-up, password change and uploads                                                                                       |
| Spam / flooding                           | Per-connection token bucket (8 burst, 1 msg/s) and 4,000-character limit; strangers must send a request first (max 20 per hour) and can't message until it's accepted      |
| SQL injection                             | Parameterized queries everywhere; `LIKE` wildcards escaped                                                                                                                 |
| Admin abuse / lockout                     | Admin API returns 404 to non-admins; every action audited; admins can't demote, suspend or delete themselves; the last admin is protected                                  |
| Admin snooping                            | No admin endpoint exposes message content, for any role; every admin action is audited                                                                                     |

**Known limit:** a web page can't block screenshots, so view-once stops saving and re-opening, not a determined screenshot.

**Secret chats:** end-to-end encrypted as described above. Known limits, stated plainly: the server can see that a photo was sent and roughly how big it is (to the nearest 4 KB), one static key per secret chat (no ratchet, so no per-message forward secrecy), and trust in the served JavaScript (as with any web E2EE). Compare the emoji fingerprint to detect key substitution. Normal chats and groups are protected in transit and by access control, and the owner can review them.

## Tech stack

React 19 · TypeScript · Tailwind CSS v4 · Vite · Cloudflare Workers · Durable Objects · D1 · Web Audio / MediaRecorder · Canvas image processing

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # optional secrets; every one can stay empty
npm run db:migrate:local
npm run dev                      # http://localhost:5173
```

Open two browser windows (one normal, one private) and sign up as two users to chat with yourself. Full guide, including Windows/macOS/Linux setup and troubleshooting: [docs/SETUP.md](docs/SETUP.md).

| Script                                 | What it does                                                            |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                          | Dev server with the Worker, Durable Objects and local D1                |
| `npm run check`                        | Format check, lint, typecheck and production build (what CI runs first) |
| `npm run format` / `npm run lint`      | Fix formatting / lint with oxlint                                       |
| `npm run test:e2e`                     | End-to-end tests                                                        |
| `npm run legal:build`                  | Rebuild the legal and help pages from `scripts/legal-pages.mjs`         |
| `npm run db:migrate:local` / `:remote` | Apply database migrations                                               |
| `npm run deploy`                       | Build and deploy to Cloudflare                                          |

## Tests

```bash
npx playwright install chromium   # once
npm run test:e2e
```

62 end-to-end tests run real browsers against the real app (Worker, Durable Objects and a local D1 database), including **real WebRTC calls between two browsers** using Chromium's fake microphones, cameras and speakers, the age gate and consent flows, and **automated accessibility checks** (axe, WCAG 2.2 AA) in light, dark and phone layouts. GitHub Actions runs formatting, lint, typecheck, build, a bundle-size budget, `npm audit` and then the whole suite on every push. Details: [docs/TESTING.md](docs/TESTING.md).

## Browser support

Latest two versions of Chrome, Edge, Firefox, Safari (macOS and iOS 16.4+) and Samsung Internet. Calls need WebRTC; secret chats need WebCrypto and IndexedDB; installing as an app and push notifications depend on the browser (iPhone: add to the Home Screen first).

## Documentation

|                                                                                        |                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md) and [decisions](docs/adr/)                        | How the pieces fit, with diagrams                  |
| [Database](docs/DATABASE.md)                                                           | Tables, ER diagram, migrations                     |
| [Setup](docs/SETUP.md) · [Deployment](docs/DEPLOYMENT.md) · [Runbook](docs/RUNBOOK.md) | Running, shipping, backups, rollback, incidents    |
| [Security measures](docs/SECURITY_MEASURES.md) · [SECURITY.md](SECURITY.md)            | What protects Relay; how to report a problem       |
| [Age & safety](docs/AGE_AND_SAFETY.md) · [Privacy data map](docs/PRIVACY_DATA_MAP.md)  | 16+ rule, moderation, every piece of personal data |
| [Accessibility](docs/ACCESSIBILITY.md) · [Testing](docs/TESTING.md)                    | Standards and how they're checked                  |
| [Audit](docs/AUDIT.md) · [Work log](docs/WORKLOG.md) · [Changelog](CHANGELOG.md)       | Findings and what changed                          |
| [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md)                | Working on Relay                                   |

Legal pages (drafts, pending legal review) are served at `/legal/terms`, `/legal/privacy`, `/legal/cookies`, `/legal/guidelines`, `/legal/accessibility` and `/legal/help`.

## Deploy (free)

Step-by-step with rollback and backups: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short:

```bash
npx wrangler login
npx wrangler d1 create relay-chat-db     # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
npm run deploy                            # → https://relay-chat.<your-subdomain>.workers.dev
```

Optional: a TURN relay so calls also connect on networks that block direct connections (Cloudflare dashboard → Realtime → TURN → create a key):

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

Make your account the owner (super admin) — only ever done from the command line, never from the app:

```bash
npx wrangler d1 execute relay-chat-db --remote --command "UPDATE users SET role='admin', super_admin=1 WHERE username='YOUR_USERNAME'"
```

Optional: push notifications while the app is closed:

```bash
node scripts/vapid-keys.mjs              # prints a key pair
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

## Roadmap

- [x] Auth, 1:1 chats, real-time messaging, typing, presence
- [x] Admin panel with audit log
- [x] Voice messages, photos, view-once photos
- [x] Replies, reactions, edit/delete, read receipts, unread badges, notifications
- [x] Profile pictures, bios, last seen, themes, custom bubble colors
- [x] Voice & video calls (WebRTC)
- [x] Documents, videos, search, jump to message, shared media gallery
- [x] Message requests, AI noise suppression in calls
- [x] Group chats, Saved Messages, pin / mute / archive, folders, forwarding, starring, pinned messages, link previews, disappearing messages
- [x] End-to-end encrypted secret chats
- [x] Installable app (PWA) with push notifications
- [x] Deep customization (fonts, sizes, shapes, custom colors, density, privacy)
- [x] Owner / admin roles, maintenance mode
- [x] Automated end-to-end tests in CI (GitHub Actions)
- [x] Chat games (team and head to head), watch together, Chill
- [x] Shared chat themes, Discord-style rail and Telegram-style tab bar
- [ ] Native mobile app (the PWA works today)

---

## More projects

- [**CarsRental**](https://github.com/Anas2103/CarsRental) — car rental manager with roles and PayPal (Laravel · React)
- [**E-Commerce**](https://github.com/Anas2103/Ecommerce) — multi-vendor store with Stripe & PayPal (Laravel · React) · [live demo](https://anas2103-ecommerce.vercel.app)
- [**HireMatch**](https://github.com/Anas2103/AiJobBoard) — AI job board that scores CVs against jobs (Laravel · React · OpenAI)
- [**SmartCourse**](https://github.com/Anas2103/SmartCoursePlatform) — online course platform with Stripe and certificates (Laravel · React)
- [**Student & Course Manager**](https://github.com/Anas2103/StudentsCourseManager) — school management with 4 roles (Laravel · React)

More about me on my [GitHub profile](https://github.com/Anas2103).

## Author

Built by **Hardouch Anas** · [GitHub](https://github.com/Anas2103)
