# Relay

Real-time, private chat built entirely on Cloudflare's free tier.

**Live demo:** https://relay-chat.bunbunchat.workers.dev

> 🚧 Work in progress: real-time 1:1 chat, accounts and the admin panel are done. Groups, media and end-to-end encryption are next.

## Features

- **Real-time messaging** over WebSockets, with optimistic sending, retry on failure and automatic reconnect plus catch-up
- **Typing indicators** and **online presence**
- **Message history** with infinite scroll
- **Mobile-first, responsive UI** with automatic dark mode
- **Admin panel**: stats, user management (create, edit, reset password, promote, suspend, sign out everywhere, delete) and an audit log of every admin action. Suspending or deleting a user disconnects their live sessions instantly.
- **Privacy by design**: admins manage accounts but have **no way to read messages**

## Architecture

```
Browser (React + Tailwind)
   │  HTTPS: /api/*  (auth, rooms, history)
   │  WSS:   /api/rooms/:id/ws
   ▼
Cloudflare Worker ── checks session + room membership
   │                         │
   ▼                         ▼
D1 (SQLite)            Durable Object "ChatRoom" (one per room)
users, sessions,       holds that room's WebSockets, broadcasts
rooms, messages        messages / typing / presence
```

- **One Durable Object per room** keeps every participant on the same instance, so broadcasting is just a loop over sockets. It uses the **WebSocket Hibernation API**, so idle rooms cost nothing.
- The Worker authenticates **before** forwarding the upgrade to the Durable Object, which never handles untrusted identity.
- The React app is served as static assets from the same Worker, so everything is same-origin: no CORS, and strict cookies.

## Security

| Threat | Mitigation |
|---|---|
| Password leaks | PBKDF2-SHA256 (100k iterations, per-user salt), constant-time compare |
| Username enumeration | Same error and same timing for unknown user vs wrong password |
| Session theft from DB | Only SHA-256 hashes of session tokens are stored |
| XSS | Session cookie is `HttpOnly`; messages rendered as text by React; strict CSP |
| CSRF / cross-site WebSocket hijacking | `SameSite=Lax` cookie and `Origin` check on all writes and WebSocket upgrades |
| Reading other people's chats | Membership checked on every history request and socket connection (returns 404, not 403) |
| Brute force | Rate limits on login (per IP and per username) and sign-up |
| Spam / flooding | Per-connection token bucket (8 burst, 1 msg/s) and 4,000-character limit |
| SQL injection | Parameterized queries everywhere; `LIKE` wildcards escaped |
| Admin abuse / lockout | Admin API returns 404 to non-admins; every action audited; admins can't demote, suspend or delete themselves; the last admin is protected |
| Admin snooping | No admin endpoint exposes message content |

**Planned:** end-to-end encryption with libsodium, so the server only stores ciphertext.

## Tech stack

React 19 · TypeScript · Tailwind CSS v4 · Vite · Cloudflare Workers · Durable Objects · D1

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
- [ ] Group chats, image sharing, reactions, replies, edit/delete, notifications
- [ ] End-to-end encryption
- [ ] Tests, CI, PWA (installable on your phone)
