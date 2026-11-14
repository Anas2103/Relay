import { LIMITS, type Profile } from "../shared/types";
import { parseSettings, requireUser } from "./auth";
import type { Env } from "./env";
import { HttpError, json } from "./http";
import { mediaHeaders } from "./media";
import { toUser } from "./rooms";

export async function searchUsers(request: Request, env: Env, url: URL): Promise<Response> {
  const me = await requireUser(request, env);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, LIMITS.usernameMax);
  if (!q) return json({ users: [] });

  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { results } = await env.DB.prepare(
    `SELECT id, username, display_name, avatar_version FROM users u
      WHERE id != ?1 AND suspended_at IS NULL AND (username LIKE ?2 ESCAPE '\\' OR display_name LIKE ?2 ESCAPE '\\')
        AND NOT EXISTS (SELECT 1 FROM blocks b
           WHERE (b.blocker_id = ?1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?1))
      ORDER BY username LIMIT 10`,
  )
    .bind(me.id, `${escaped}%`)
    .all<{ id: string; username: string; display_name: string; avatar_version: number | null }>();

  return json({ users: results.map(toUser) });
}

export async function getProfile(request: Request, env: Env, userId: string): Promise<Response> {
  const me = await requireUser(request, env);
  // "Last seen" is only shared with people you have an accepted chat with
  // (not strangers, and not someone whose message request you haven't accepted).
  const row = await env.DB.prepare(
    `SELECT id, username, display_name, avatar_version, bio, last_seen_at, created_at, settings, status_text,
            (SELECT settings FROM users WHERE id = ?2) AS my_settings,
            (id = ?2 OR EXISTS (
              SELECT 1 FROM room_members a
                JOIN room_members b ON b.room_id = a.room_id AND b.user_id = ?2
                JOIN rooms r ON r.id = a.room_id AND r.status = 'accepted'
               WHERE a.user_id = users.id)) AS contact
       FROM users WHERE id = ?1 AND suspended_at IS NULL`,
  )
    .bind(userId, me.id)
    .first<{
      id: string;
      username: string;
      display_name: string;
      avatar_version: number | null;
      bio: string;
      last_seen_at: number | null;
      created_at: number;
      settings: string;
      status_text: string;
      my_settings: string | null;
      contact: number;
    }>();
  if (!row) throw new HttpError(404, "User not found.");
  // Hidden if either side chose "Last seen: nobody" (it works both ways, like Telegram).
  const hidden = row.id !== me.id && (parseSettings(row.settings).lastSeen === "nobody" || parseSettings(row.my_settings).lastSeen === "nobody");
  const contact = row.contact === 1 && !hidden;
  const profile: Profile = {
    ...toUser(row),
    bubbleColor: parseSettings(row.settings).bubbleColor,
    bio: row.bio,
    lastSeenAt: contact ? row.last_seen_at : null,
    createdAt: row.created_at,
    statusText: row.status_text ?? "",
    dnd: parseSettings(row.settings).presence === "dnd",
  };
  return json({ profile });
}

export async function getAvatar(request: Request, env: Env, userId: string): Promise<Response> {
  await requireUser(request, env);
  const row = await env.DB.prepare("SELECT mime, data FROM avatars WHERE user_id = ?1")
    .bind(userId)
    .first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!row) throw new HttpError(404, "No profile picture.");
  const bytes = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
  // URLs carry ?v=<version>, so the browser can cache forever.
  return new Response(bytes, { headers: mediaHeaders(row.mime, "immutable") });
}
