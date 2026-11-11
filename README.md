# Relay

Real-time, private chat with voice notes, photos and view-once pictures, running entirely on Cloudflare's free tier.

**Live demo:** https://relay-chat.bunbunchat.workers.dev

## Features

**Messaging**
- Real-time chat over WebSockets, with optimistic sending, retry on failure and automatic reconnect plus catch-up
- **Voice messages**: tap to record with a live waveform; playback with seek and 1× / 1.5× / 2× speed
- **Photos**: compressed in the browser (a 4 MB photo becomes ~250 KB, with EXIF/GPS stripped), paste or drag-and-drop, captions
- **View-once photos**: each recipient can open them exactly once, enforced by the server; deleted after everyone has seen them
- Replies with quoted previews, emoji reactions, edit, delete for everyone
- Read receipts (✓ / ✓✓), typing indicators, unread badges, a "new messages" jump button

**People**
- Profile pictures, bios and a profile page
- Online status and "last seen", shared only with people you chat with
- Instant sidebar updates, desktop notifications and message sounds for other chats

**Personalization**
- Light, dark or system theme, with no flash on load
- Choose your own chat bubble color; settings sync across devices

**Admin panel**
- Stats, user management (create, edit, reset password, promote, suspend, sign out everywhere, delete) and an audit log
- **Privacy by design**: admins can manage accounts but have no way to read messages

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
| Password leaks | PBKDF2-SHA256 (100k iterations, per-user salt), constant-time compare |
| Username enumeration | Same error and same timing for unknown user vs wrong password |
| Session theft from DB | Only SHA-256 hashes of session tokens are stored |
| XSS | `HttpOnly` cookie; messages rendered as text (links built as React elements); strict CSP |
| Malicious uploads | File type detected from the bytes ("magic numbers"), not the client's claim; served with `nosniff` and a sandbox CSP; size and type metadata always come from the server |
| Huge uploads | Streamed with a byte counter, so oversized files are refused without being held in memory |
| View-once bypass | Sender can't open it; each recipient gets one atomic claim (database `INSERT … ON CONFLICT DO NOTHING`); `no-store` caching; file deleted once all recipients have seen it |
| CSRF / cross-site WebSocket hijacking | `SameSite=Lax` cookie and `Origin` check on all writes and WebSocket upgrades |
| Reading other people's chats or media | Membership checked on every history, upload, download and socket request (returns 404, not 403) |
| Brute force | Rate limits on login (per IP and per username), sign-up, password change and uploads |
| Spam / flooding | Per-connection token bucket (8 burst, 1 msg/s) and 4,000-character limit |
| SQL injection | Parameterized queries everywhere; `LIKE` wildcards escaped |
| Admin abuse / lockout | Admin API returns 404 to non-admins; every action audited; admins can't demote, suspend or delete themselves; the last admin is protected |
| Admin snooping | No admin endpoint exposes message content |

**Known limit:** a web page can't block screenshots, so view-once stops saving and re-opening, not a determined screenshot.

**Planned:** end-to-end encryption with libsodium, so the server only stores ciphertext.

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

Make your account an admin (one-time):

```bash
npx wrangler d1 execute relay-chat-db --remote --command "UPDATE users SET role='admin' WHERE username='YOUR_USERNAME'"
```

## Roadmap

- [x] Auth, 1:1 chats, real-time messaging, typing, presence
- [x] Admin panel with audit log
- [x] Voice messages, photos, view-once photos
- [x] Replies, reactions, edit/delete, read receipts, unread badges, notifications
- [x] Profile pictures, bios, last seen, themes, custom bubble colors
- [ ] Group chats
- [ ] End-to-end encryption
- [ ] Installable app (PWA) with push notifications
- [ ] Voice & video calls (WebRTC)
- [ ] Automated tests in CI
