# Privacy data map

Every piece of personal data Relay stores, why, for how long, and where the Privacy Policy covers it. Keep this in sync with the code and with `scripts/legal-pages.mjs`.

| Data (table.column)                                                                                                                | Purpose                            | Retention                                                             | Privacy Policy    |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- | ----------------- |
| `users.username`, `display_name`                                                                                                   | Account, shown to contacts         | Until account deletion                                                | §1 row 1          |
| `users.password_hash` (PBKDF2-SHA256, salted)                                                                                      | Sign-in                            | Until deletion                                                        | §1 row 1          |
| `users.birth_date`                                                                                                                 | Age check (16+)                    | Until deletion                                                        | §1 row 2          |
| `users.terms_version`, `terms_accepted_at`                                                                                         | Proof of agreement                 | Until deletion                                                        | §1 row 3          |
| `users.bio`, `status_text`, `avatar_version` + `avatars`, `users.settings`                                                         | Profile and preferences            | Until changed or deleted                                              | §1 row 4          |
| `messages.*`, `message_reactions`, `poll_votes`, `starred`, `media_views`, Durable Object media storage, `stickers`, `rooms.theme` | Conversations                      | Until deleted by a person, the disappearing timer or account deletion | §1 row 5          |
| Secret-chat ciphertext, `secret_keys` (public keys only)                                                                           | E2EE chats                         | Until the secret chat ends                                            | §1 row 6          |
| `stories`, `story_views`                                                                                                           | Stories                            | 24 hours (cron)                                                       | §1 row 7          |
| `messages.meta.location`                                                                                                           | Shared location                    | Like messages                                                         | §1 row 8          |
| `sessions.device`, `location` (Cloudflare city/country), `created_at`, `last_active_at`; `login_challenges`                        | Devices list, alerts, security     | Until sign-out or expiry; expired rows purged daily                   | §1 row 9          |
| `users.totp_secret`, `recovery_codes` (hashed), `totp_last_step`                                                                   | Two-step verification              | Until turned off                                                      | §1 row 10         |
| `users.last_seen_at`, `last_login_at`                                                                                              | Presence, admin overview           | Latest value only                                                     | §1 row 11         |
| `push_subscriptions`                                                                                                               | Push notifications                 | Until turned off                                                      | §1 row 12         |
| `reports`, `blocks`, `group_bans`                                                                                                  | Safety                             | Until resolved / unblocked                                            | §1 row 13         |
| `rate_limits` (keys contain an IP address or username)                                                                             | Abuse prevention                   | ≤ 2 days (purged daily)                                               | §1 row 14         |
| `admin_audit`                                                                                                                      | Accountability                     | As long as needed                                                     | §1 row 15         |
| `transcripts`, `translations` (Workers AI results)                                                                                 | Cache for "Transcribe"/"Translate" | Until the message is deleted                                          | §3 (Workers AI)   |
| `link_previews` (public page titles/images)                                                                                        | Link previews                      | Cache                                                                 | Not personal data |
| `chill_cache` (search results)                                                                                                     | Chill                              | Hours to 30 days                                                      | Not personal data |

**On the device only** (never sent to the server): appearance cache, drafts, device choices, scores, offline copy of chats (IndexedDB), secret-chat private keys (non-extractable), passcode hash. Covered in the Cookies & storage page.

**Not collected:** email, phone number, contacts, precise location (except a location someone shares in a chat), analytics or advertising identifiers.

## Processors

| Processor                                                   | What                                         | Where                         |
| ----------------------------------------------------------- | -------------------------------------------- | ----------------------------- |
| Cloudflare (Workers, D1, Durable Objects, TURN, Workers AI) | Hosting, storage, calls relay, AI on request | Global network (incl. EU, US) |
| Browser push services (Google, Apple, Mozilla, Microsoft)   | Wake-up signals with no content              | Depends on the browser        |

Chill calls YouTube, Apple iTunes, Radio Browser, Open Trivia DB and JokeAPI **from the server**, so they never see the user. The YouTube player (youtube-nocookie.com) loads in the browser only when a video is played.
