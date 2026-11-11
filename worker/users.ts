import { LIMITS, type Profile } from "../shared/types";
import { requireUser } from "./auth";
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
    `SELECT id, username, display_name, avatar_version FROM users
      WHERE id != ?1 AND suspended_at IS NULL AND (username LIKE ?2 ESCAPE '\\' OR display_name LIKE ?2 ESCAPE '\\')
      ORDER BY username LIMIT 10`,
  )
    .bind(me.id, `${escaped}%`)
    .all<{ id: string; username: string; display_name: string; avatar_version: number | null }>();

  return json({ users: results.map(toUser) });
}

export async function getProfile(request: Request, env: Env, userId: string): Promise<Response> {
  await requireUser(request, env);
  const row = await env.DB.prepare(
    `SELECT id, username, display_name, avatar_version, bio, last_seen_at, created_at
       FROM users WHERE id = ?1 AND suspended_at IS NULL`,
  )
    .bind(userId)
    .first<{
      id: string;
      username: string;
      display_name: string;
      avatar_version: number | null;
      bio: string;
      last_seen_at: number | null;
      created_at: number;
    }>();
  if (!row) throw new HttpError(404, "User not found.");
  const profile: Profile = { ...toUser(row), bio: row.bio, lastSeenAt: row.last_seen_at, createdAt: row.created_at };
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
