# Database

Relay uses **Cloudflare D1** (SQLite). The schema lives in [`migrations/`](../migrations), applied in number order. Each chat's media (photos, videos, voice notes, files) is stored separately, in that chat's Durable Object SQLite storage (`media`, `media_chunks`, `scheduled` tables in `worker/room.ts`).

## Main tables

```mermaid
erDiagram
  users ||--o{ sessions : "signs in on"
  users ||--o{ room_members : "is in"
  rooms ||--o{ room_members : has
  rooms ||--o{ messages : contains
  users ||--o{ messages : writes
  messages ||--o{ message_reactions : gets
  messages ||--o{ poll_votes : gets
  users ||--o{ blocks : blocks
  users ||--o{ reports : files
  users ||--o{ stories : posts
  users ||--o{ stickers : saves
  users ||--o{ push_subscriptions : has
  rooms ||--o{ secret_keys : "E2EE public keys"

  users {
    text id PK
    text username UK "case-insensitive"
    text display_name
    text password_hash "pbkdf2$iterations$salt$hash"
    text birth_date "YYYY-MM-DD, null for old accounts"
    text terms_version
    int terms_accepted_at
    text role "user | admin"
    int super_admin "owner"
    text settings "JSON"
    text totp_secret
    int suspended_until
    int restricted_until
  }
  sessions {
    text token_hash PK "SHA-256 of the cookie token"
    text user_id FK
    int expires_at
    text device
    text location "city, country"
  }
  rooms {
    text id PK
    text type "dm | group"
    text status "pending | accepted"
    text dm_key "pair key, secret:, saved:"
    int disappear_ms
    text theme "shared chat theme"
    int admins_only
    int slow_mode_ms
  }
  room_members {
    text room_id FK
    text user_id FK
    text role "member | admin"
    int last_read_at
    int pinned_at
    int archived
    int muted_until
  }
  messages {
    text id PK
    text room_id FK
    text user_id FK
    text kind "text, image, voice, video, file, call, poll, game"
    text body
    text meta "JSON: media info, poll, game state"
    int created_at
    int expires_at "disappearing messages"
    int deleted_at
  }
```

Other tables: `admin_audit`, `site_settings`, `rate_limits`, `login_challenges`, `link_previews`, `starred`, `media_views`, `avatars`, `room_avatars`, `group_bans`, `story_views`, `transcripts`, `translations`, `chill_cache`. Each migration file starts with a comment explaining its tables.

## Migrations

```bash
# Create a new one: next number, short name
#   migrations/0017_something.sql
npm run db:migrate:local    # apply to the local database (tests do this automatically)
npm run db:migrate:remote   # apply to production: do this BEFORE deploying code that needs it
```

Rules: never edit a migration that has run in production; add a new one. Prefer `ALTER TABLE … ADD COLUMN` with a safe default, so old code keeps working until the new code is deployed.

## Housekeeping (cron, every 15 minutes)

`scheduled()` in `worker/index.ts`: deletes expired disappearing messages, lifts finished suspensions, removes stories after 24 h, trims the Chill cache, and purges old rate-limit counters, expired sessions and expired sign-in challenges.
