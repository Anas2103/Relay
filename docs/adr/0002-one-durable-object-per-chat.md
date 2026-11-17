# 2. One Durable Object per conversation

**Status:** accepted · **Date:** 2026-11-11

**Context.** Messages in a chat must be ordered and delivered to everyone with the chat open.

**Decision.** Each conversation gets its own `ChatRoom` Durable Object, which owns its sockets, orders messages (strictly increasing timestamps) and referees games.

**Consequences.** Broadcasting is a loop over local sockets; no pub/sub service. A very large group would concentrate load on one object, which is fine at Relay's scale.
