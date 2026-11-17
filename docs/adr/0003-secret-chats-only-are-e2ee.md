# 3. Only secret chats are end-to-end encrypted

**Status:** accepted · **Date:** 2026-11-13

**Context.** The owner wants to be able to review conversations for moderation, and also wants private conversations nobody can read.

**Decision.** Like Telegram: normal chats are stored readable by the server (owner review is audited); "secret chats" are opt-in, 1:1, device-bound and E2EE (ECDH P-256 → HKDF → AES-256-GCM, non-extractable keys).

**Consequences.** Moderation works for normal chats; secret chats can't be moderated by content, only by reports where the reporter shares the decrypted text. This is stated in the Privacy Policy.
