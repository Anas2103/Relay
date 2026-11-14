# Relay

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
- Formatting: **bold**, *italic*, __underline__, ~~strike~~, `code`, code blocks, > quotes and ||spoilers|| (rendered as React elements, never HTML). Ctrl/⌘+B, I, U, E, Shift+X, Shift+S shortcuts
- **@mentions** with suggestions; mentions and replies to you alert you even in muted chats, with an @ badge in the chat list
- **Polls** (single or multiple answer), **multi-select** (copy, forward, delete), per-chat **drafts**, **send without sound**
- Groups: **invite links** (reset or turn off), **announcement mode** (only admins post), **slow mode**
- **Custom status** and **Do Not Disturb / Invisible** presence
- **Ctrl/⌘+K quick switcher** and Alt+↑/↓ to move between chats
- **Scheduled messages**, kept and sent by the chat's own server even when your device is off
- **Search across all your chats** (never secret chats), jumping straight to the message
- **"Seen by"** in groups, an **"Unread messages"** divider, **group photos** and a shareable **profile link** (`/?u=username`)

**Moderation**
- **Report** a message or a person; the reported text is copied at the time, so deleting it afterwards doesn't hide it. In secret chats, the reporter chooses to share the decrypted text
- Admins get a **Reports** tab (resolve, dismiss, suspend), with every action in the audit log
- Group admins can **remove and ban** (invite links won't let a banned person back in) and manage the ban list

**Secret chats (end-to-end encrypted)**
- Start one from any 1:1 chat. Keys are made on your device (ECDH P-256 → HKDF-SHA256 → AES-256-GCM via WebCrypto); the private key is **non-extractable**, so not even the app's own JavaScript can read it out
- The server only ever stores ciphertext and **refuses anything else** in a secret chat (and refuses ciphertext in normal chats, so nothing can fake being private). Nobody else can read them: not the server, not admins, not the owner
- Like Telegram: device-bound, text-only, can't be forwarded, support disappearing messages, and signing out removes their keys from that device
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
- Call history in the chat ("Missed video call", "Voice call · 3:20"); tap to call back
- Works with free public STUN; optional Cloudflare TURN relay for restrictive networks

**Messaging**
- Real-time chat over WebSockets, with optimistic sending, retry on failure and automatic reconnect plus catch-up
- **Documents and videos** up to 20 MB, with upload progress; videos stream with byte ranges (instant seeking, iPhone-compatible)
- **Search** a whole conversation and **jump to any message**, however old (history loads around it in both directions)
- **Contact info** with Media, Files, Links and Voice tabs
- **Voice messages**: tap to record with a live waveform; playback with seek and 1× / 1.5× / 2× speed
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
- System / light / dark, with 10 light and 12 dark styles, 20 wallpapers
- App color and bubble color from a palette, 16 gradients or **any custom color** (readable text worked out automatically to WCAG AA)
- Message text size, whole-app size, 6 fonts, bubble corner roundness, spacing density, chat width, round/rounded/square avatars, 12/24-hour time, animations on/off
- Enter-to-send or Ctrl+Enter, link previews, chat-list previews, the "Online now" row
- Privacy: hide last seen (works both ways, like Telegram), hide typing, blocked list
- Your data: export everything as JSON, delete your account

**App**
- Installable (PWA) on phones and desktops, unread badge on the app icon, push notifications that never contain message content
- Layouts built for every size: bottom sheets on phones, side panels and popovers on desktop, safe areas for notches

**Admin & owner**
- **Admins** manage regular accounts only. **The owner (super admin)** can do everything: manage admins too, review and moderate any conversation or group, and control the site (announcement banner, sign-ups, **maintenance mode**). Secret chats are the one thing nobody can read
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

| Threat | Mitigation |
|---|---|
| Password leaks | PBKDF2-SHA256 (100k iterations, per-user salt), constant-time compare; common passwords refused |
| Stolen password | Optional two-step verification (TOTP + one-time recovery codes, replay-protected) |
| Stolen / forgotten device | Devices list with remote sign-out (live disconnect), auto sign-out of idle devices, new sign-in alerts, local passcode lock |
| Clickjacking, XSS, data leaks via headers | CSP, frame-ancestors 'none', X-Frame-Options, HSTS preload, COOP/CORP, Referrer-Policy: no-referrer |
| Username enumeration | Same error and same timing for unknown user vs wrong password |
| Session theft from DB | Only SHA-256 hashes of session tokens are stored |
| XSS | `HttpOnly` cookie; messages rendered as text (links built as React elements); strict CSP |
| Malicious uploads | File type detected from the bytes ("magic numbers"), not the client's claim; served with `nosniff` and a sandbox CSP; size and type metadata always come from the server |
| Huge uploads | Streamed with a byte counter, so oversized files are refused without being held in memory |
| View-once bypass | Sender can't open it; each recipient gets one atomic claim (database `INSERT … ON CONFLICT DO NOTHING`); `no-store` caching; file deleted once all recipients have seen it |
| CSRF / cross-site WebSocket hijacking | `SameSite=Lax` cookie and `Origin` check on all writes and WebSocket upgrades |
| Reading other people's chats or media | Membership checked on every history, upload, download and socket request (returns 404, not 403) |
| Brute force | Rate limits on login (per IP and per username), sign-up, password change and uploads |
| Spam / flooding | Per-connection token bucket (8 burst, 1 msg/s) and 4,000-character limit; strangers must send a request first (max 20 per hour) and can't message until it's accepted |
| SQL injection | Parameterized queries everywhere; `LIKE` wildcards escaped |
| Admin abuse / lockout | Admin API returns 404 to non-admins; every action audited; admins can't demote, suspend or delete themselves; the last admin is protected |
| Admin snooping | No admin endpoint exposes message content, for any role; every admin action is audited |

**Known limit:** a web page can't block screenshots, so view-once stops saving and re-opening, not a determined screenshot.

**Secret chats:** end-to-end encrypted as described above. Known limits, stated plainly: one static key per secret chat (no ratchet, so no per-message forward secrecy), and trust in the served JavaScript (as with any web E2EE). Compare the emoji fingerprint to detect key substitution. Normal chats and groups are protected in transit and by access control, and the owner can review them.

## Tech stack

React 19 · TypeScript · Tailwind CSS v4 · Vite · Cloudflare Workers · Durable Objects · D1 · Web Audio / MediaRecorder · Canvas image processing

## Run locally

```bash
npm install
npm run db:migrate:local
npm run dev            # http://localhost:5173
```

Open two browser windows (one normal, one private) and sign up as two users to chat with yourself.

## Deploy (free)

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
- [ ] Automated tests in CI
- [ ] Native mobile app (the PWA works today)
