# Architecture

## Overview

```mermaid
flowchart LR
  subgraph Browser
    UI[React app<br/>src/]
    SW[Service worker<br/>public/sw.js]
    IDB[(IndexedDB<br/>offline copy, E2EE keys)]
  end
  subgraph Cloudflare
    W[Worker<br/>worker/index.ts]
    A[Static assets<br/>dist/client]
    R[[ChatRoom Durable Object<br/>one per conversation]]
    L[[Lobby Durable Object<br/>one for the app]]
    D[(D1 / SQLite)]
    AI[Workers AI]
  end
  UI -- HTTPS /api/* --> W
  UI -- WSS /api/rooms/:id/ws --> W --> R
  UI -- WSS /api/lobby --> W --> L
  W --> D
  R --> D
  W --> AI
  Browser -- pages, JS, CSS --> A
  UI <--> IDB
  SW --- A
```

- **One Worker** serves the app's files and the API. Requests that aren't `/api/*` are static assets (`run_worker_first` in `wrangler.jsonc`).
- **ChatRoom Durable Object** (`worker/room.ts`): one instance per conversation, so everyone in a chat shares one place where messages are ordered and broadcast. It also keeps that chat's media in its own SQLite storage.
- **Lobby Durable Object** (`worker/lobby.ts`): presence, chat-list updates, call signaling, broadcasts.
- Both use the **WebSocket Hibernation API**, so idle connections cost nothing.
- **The Worker checks identity and room membership before forwarding** anything to a Durable Object, which trusts only the identity the Worker passes in.

## Folder structure

```
shared/     Types and rules used by both sides (types, games, chat themes, legal/age rules, password rules)
worker/     Server: one file per area (auth, rooms, messages, media, features, admin, owner, moderation…)
src/        React app
  components/   Screens and UI pieces (games/ and chill/ are sub-areas)
  lib/          Non-UI logic: API client, calls engine, E2EE, offline store, theme, music player
migrations/ D1 schema, numbered and applied in order
public/     Files served as-is: service worker, icons, legal pages, headers
scripts/    Small Node tools (icons, VAPID keys, legal pages)
tests/      Playwright end-to-end tests
docs/       This documentation
```

Layered by side (shared / server / client) rather than by feature, because the rules in `shared/` must be identical on both sides (the server enforces, the app gives instant feedback).

## Sending a message

```mermaid
sequenceDiagram
  participant A as Ann's browser
  participant W as Worker
  participant R as ChatRoom DO
  participant D as D1
  participant L as Lobby DO
  participant B as Ben's browser
  A->>W: WebSocket upgrade /api/rooms/:id/ws (cookie)
  W->>W: session + membership check
  W->>R: forward socket with verified identity
  A->>R: {type: "send", clientId, body}
  R->>R: rate limit, rules (blocked? slow mode? read-only?)
  R->>D: INSERT message
  R-->>A: {type: "message"} (confirms clientId)
  R-->>B: {type: "message"} (if the chat is open)
  R->>L: activity → chat lists, notifications, push
  L-->>B: {type: "activity"}
```

## Signing in

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Worker
  participant D as D1
  B->>W: POST /api/auth/login
  W->>W: rate limits (per IP and per username)
  W->>D: user + PBKDF2 check (a dummy hash runs for unknown users)
  alt 2FA on
    W-->>B: challenge
    B->>W: POST /api/auth/2fa (code)
  end
  W->>D: INSERT session (SHA-256 of the token only)
  W-->>B: Set-Cookie sid (HttpOnly, Secure, SameSite=Lax)
```

## Decisions (short ADRs)

See [`adr/`](adr/).
