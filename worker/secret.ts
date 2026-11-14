import { MUTE_FOREVER, type SecretInfo } from "../shared/types";
import { rateLimit, requireUser } from "./auth";
import { lobby, room, type Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { roomMemberIds } from "./messages";
import { assertMember, blockState, listRooms } from "./rooms";

/*
 * Telegram-style chat features that don't fit elsewhere:
 *  - Saved Messages (a private chat with yourself)
 *  - per-person chat-list preferences: pin, archive, mute
 *  - deleting a chat
 *  - Secret chats: end-to-end encrypted 1:1 chats.
 *
 * How secret chats work
 * ---------------------
 * 1. In a normal, accepted 1:1 chat, either person taps "Start secret chat". Their
 *    browser creates an ECDH P-256 key pair whose private half is NON-EXTRACTABLE
 *    (WebCrypto keeps it in the browser; not even our own JavaScript can read it
 *    out) and sends only the public half here.
 * 2. The other person opens the invitation on one of their devices, which does the
 *    same and registers its public key.
 * 3. Each device combines its private key with the other's public key (ECDH), and
 *    derives an AES-256-GCM key with HKDF. Both end up with the same key; it never
 *    travels over the network.
 * 4. Messages are encrypted before they leave the device. The server, the database
 *    and every admin (the owner included) only ever see ciphertext, which the room
 *    server enforces: a secret chat rejects anything that isn't well-formed ciphertext.
 *
 * Like Telegram, a secret chat lives on the two devices that set it up: other
 * devices see that it exists but can't read it.
 */

const UUID_RE = /^[0-9a-f-]{36}$/;
/** base64url of an uncompressed P-256 point (65 bytes -> 87 chars). */
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{87}$/;

function cleanKey(body: { deviceId?: unknown; publicKey?: unknown }): { deviceId: string; publicKey: string } {
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const publicKey = typeof body.publicKey === "string" ? body.publicKey : "";
  if (!UUID_RE.test(deviceId) || !PUBLIC_KEY_RE.test(publicKey)) throw new HttpError(400, "Invalid encryption key.");
  return { deviceId, publicKey };
}

async function roomRow(env: Env, roomId: string) {
  return env.DB.prepare("SELECT id, type, status, requested_by, dm_key FROM rooms WHERE id = ?1")
    .bind(roomId)
    .first<{ id: string; type: "dm" | "group"; status: string; requested_by: string | null; dm_key: string | null }>();
}

// ---------------------------------------------------------------------------
// Saved Messages
// ---------------------------------------------------------------------------

export async function openSaved(request: Request, env: Env): Promise<Response> {
  const me = await requireUser(request, env);
  const key = `saved:${me.id}`;
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO rooms (id, type, dm_key, created_at, status, created_by) VALUES (?1, 'dm', ?2, ?3, 'accepted', ?4)",
  )
    .bind(id, key, now, me.id)
    .run();
  const saved = await env.DB.prepare("SELECT id FROM rooms WHERE dm_key = ?1").bind(key).first<{ id: string }>();
  if (!saved) throw new Error("Saved Messages missing after insert");
  await env.DB.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?1, ?2, ?3)")
    .bind(saved.id, me.id, now)
    .run();
  const [result] = await listRooms(env, me.id, saved.id);
  return json({ room: result });
}

// ---------------------------------------------------------------------------
// Chat-list preferences (only affect you)
// ---------------------------------------------------------------------------

export async function updatePrefs(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const body = await readJson<{ pinned?: unknown; archived?: unknown; mutedUntil?: unknown }>(request);
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (typeof body.pinned === "boolean") {
    if (body.pinned) {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM room_members WHERE user_id = ?1 AND pinned_at IS NOT NULL")
        .bind(me.id)
        .first<{ n: number }>();
      if ((count?.n ?? 0) >= 10) throw new HttpError(400, "You can pin up to 10 chats.");
    }
    sets.push("pinned_at = ?");
    binds.push(body.pinned ? Date.now() : null);
  }
  if (typeof body.archived === "boolean") {
    sets.push("archived = ?");
    binds.push(body.archived ? 1 : 0);
    // Archiving unpins, like Telegram.
    if (body.archived) sets.push("pinned_at = NULL");
  }
  if (body.mutedUntil !== undefined) {
    const until = body.mutedUntil === null ? null : Number(body.mutedUntil);
    if (until !== null && (!Number.isFinite(until) || until < Date.now() || until > MUTE_FOREVER)) {
      throw new HttpError(400, "Invalid mute time.");
    }
    sets.push("muted_until = ?");
    binds.push(until);
  }
  if (sets.length === 0) throw new HttpError(400, "Nothing to change.");

  await env.DB.prepare(`UPDATE room_members SET ${sets.join(", ")} WHERE room_id = ? AND user_id = ?`)
    .bind(...binds, roomId, me.id)
    .run();
  // Your other devices update their chat list too.
  await lobby(env).notify([me.id], { type: "rooms-changed" });
  const [result] = await listRooms(env, me.id, roomId);
  return json({ room: result });
}

// ---------------------------------------------------------------------------
// Delete a chat (for everyone in it)
// ---------------------------------------------------------------------------

/**
 * 1:1 chats, secret chats and Saved Messages: either person can delete the chat for both.
 * Groups: only a group admin can delete the whole group (members use "Leave").
 */
export async function deleteChat(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  const membership = await env.DB.prepare("SELECT role FROM room_members WHERE room_id = ?1 AND user_id = ?2")
    .bind(roomId, me.id)
    .first<{ role: string }>();
  if (!membership) throw new HttpError(404, "Chat not found.");
  const r = await roomRow(env, roomId);
  if (!r) throw new HttpError(404, "Chat not found.");
  if (r.type === "group" && membership.role !== "admin") throw new HttpError(403, "Only group admins can delete the group.");

  const members = await roomMemberIds(env.DB, roomId);
  await env.DB.prepare("DELETE FROM rooms WHERE id = ?1").bind(roomId).run();
  const stub = room(env, roomId);
  await Promise.all(members.map((id) => stub.removeMember(id).catch(() => undefined)));
  await stub.wipeMedia().catch(() => undefined);
  await lobby(env).notify(members, { type: "rooms-changed" });
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Secret chats
// ---------------------------------------------------------------------------

/** Starts a secret chat with the other person in an accepted 1:1 chat. */
export async function startSecret(request: Request, env: Env, dmId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, dmId, me.id);
  const key = cleanKey(await readJson(request));
  const dm = await roomRow(env, dmId);
  if (!dm || dm.type !== "dm" || !dm.dm_key) throw new HttpError(404, "Chat not found.");
  if (dm.dm_key.startsWith("secret:") || dm.dm_key.startsWith("saved:")) {
    throw new HttpError(400, "Start a secret chat from your normal chat with this person.");
  }
  if (dm.status !== "accepted") throw new HttpError(400, "You can start a secret chat once your friend request is accepted.");

  const otherId = (await roomMemberIds(env.DB, dmId)).find((id) => id !== me.id);
  if (!otherId) throw new HttpError(404, "Chat not found.");
  const block = await blockState(env, me.id, otherId);
  if (block.iBlocked || block.blockedMe) throw new HttpError(403, "You can't start a secret chat with this person.");

  // One secret chat per pair at a time (end the old one to start fresh).
  const secretKey = `secret:${[me.id, otherId].sort().join(":")}`;
  const existing = await env.DB.prepare("SELECT id FROM rooms WHERE dm_key = ?1").bind(secretKey).first<{ id: string }>();
  if (existing) {
    const [result] = await listRooms(env, me.id, existing.id);
    return json({ room: result, existing: true });
  }

  await rateLimit(env, `secret:${me.id}`, 10, 60 * 60 * 1000);
  const id = crypto.randomUUID();
  const now = Date.now();
  const addMember = env.DB.prepare("INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?1, ?2, ?3)");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rooms (id, type, dm_key, created_at, status, requested_by, created_by) VALUES (?1, 'dm', ?2, ?3, 'pending', ?4, ?4)",
    ).bind(id, secretKey, now, me.id),
    addMember.bind(id, me.id, now),
    addMember.bind(id, otherId, now),
    env.DB.prepare(
      "INSERT INTO secret_keys (room_id, user_id, device_id, public_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(id, me.id, key.deviceId, key.publicKey, now),
  ]);
  await lobby(env).notify([otherId], { type: "rooms-changed" });
  const [result] = await listRooms(env, me.id, id);
  return json({ room: result, existing: false }, 201);
}

/** The invited person accepts on one of their devices, which registers that device's key. */
export async function acceptSecret(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const key = cleanKey(await readJson(request));
  const r = await roomRow(env, roomId);
  if (!r?.dm_key?.startsWith("secret:")) throw new HttpError(404, "Secret chat not found.");
  if (r.requested_by === me.id) throw new HttpError(400, "Waiting for them to accept.");
  if (r.status === "accepted") throw new HttpError(409, "This secret chat was already accepted on another device.");

  const otherId = r.requested_by!;
  const block = await blockState(env, me.id, otherId);
  if (block.iBlocked || block.blockedMe) throw new HttpError(403, "You can't accept this secret chat.");

  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO secret_keys (room_id, user_id, device_id, public_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(roomId, me.id, key.deviceId, key.publicKey, Date.now())
    .run();
  if (!res.meta.changes) throw new HttpError(409, "This secret chat was already accepted on another device.");
  await env.DB.prepare("UPDATE rooms SET status = 'accepted' WHERE id = ?1").bind(roomId).run();
  await room(env, roomId).setAccepted();
  await lobby(env).notify([otherId, me.id], { type: "rooms-changed" });
  const [result] = await listRooms(env, me.id, roomId);
  return json({ room: result });
}

/** Public keys only. */
export async function getSecretInfo(request: Request, env: Env, roomId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertMember(env, roomId, me.id);
  const r = await roomRow(env, roomId);
  if (!r?.dm_key?.startsWith("secret:")) throw new HttpError(404, "Secret chat not found.");
  const { results } = await env.DB.prepare("SELECT user_id, device_id, public_key FROM secret_keys WHERE room_id = ?1")
    .bind(roomId)
    .all<{ user_id: string; device_id: string; public_key: string }>();
  const info: SecretInfo = {
    roomId,
    initiatorId: r.requested_by ?? "",
    keys: results.map((k) => ({ userId: k.user_id, deviceId: k.device_id, publicKey: k.public_key })),
  };
  return json({ secret: info });
}
