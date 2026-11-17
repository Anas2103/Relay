# 1. Run everything on Cloudflare Workers

**Status:** accepted · **Date:** 2026-11-11

**Context.** Relay needs real-time WebSockets, a database and file storage, on a total budget under 100 MAD, without a free tier that sleeps after inactivity.

**Decision.** One Worker serves the app and API; Durable Objects handle live connections; D1 stores data; media is kept in each chat's Durable Object storage.

**Consequences.** Free, global and always on. Tied to Cloudflare's APIs; Workers' limits apply (e.g. PBKDF2 capped at 100,000 iterations, no native argon2).
