import { assertAllowed } from "./policy";
import { LIMITS, STORY_BACKGROUNDS, type Story, type StoryGroup, type User } from "../shared/types";
import { rateLimit, requireUser } from "./auth";
import type { Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { mediaHeaders, readUpload } from "./media";
import { toUser } from "./rooms";

/*
 * Stories: a photo or a short text that your contacts (people you have an
 * accepted 1:1 chat with, and haven't blocked) can see for 24 hours. You see
 * who viewed yours. The 15-minute cron deletes expired ones.
 */

const DAY = 24 * 60 * 60 * 1000;
const ID_RE = /^[0-9a-f-]{36}$/;

/** People whose stories I can see (and who can see mine): accepted, unblocked 1:1 contacts. */
const CONTACTS = `
  SELECT DISTINCT other.user_id AS id
    FROM room_members me
    JOIN rooms r ON r.id = me.room_id AND r.type = 'dm' AND r.status = 'accepted'
    JOIN room_members other ON other.room_id = me.room_id AND other.user_id != me.user_id
   WHERE me.user_id = ?1
     AND NOT EXISTS (SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ?1 AND b.blocked_id = other.user_id) OR (b.blocker_id = other.user_id AND b.blocked_id = ?1))`;

async function canSee(env: Env, meId: string, authorId: string): Promise<boolean> {
  if (meId === authorId) return true;
  const row = await env.DB.prepare(`SELECT 1 FROM (${CONTACTS}) WHERE id = ?2`).bind(meId, authorId).first();
  return !!row;
}

interface StoryRow {
  id: string;
  user_id: string;
  kind: "text" | "image";
  text: string;
  background: string | null;
  width: number | null;
  height: number | null;
  created_at: number;
  expires_at: number;
  username: string;
  display_name: string;
  avatar_version: number | null;
  viewed: number;
  views: number;
}

export async function routeStories(request: Request, env: Env, path: string, url: URL): Promise<Response> {
  const me = await requireUser(request, env);
  const m = request.method;
  const now = Date.now();

  // Everyone's live stories: mine first, then people with unseen ones, newest first.
  if (path === "/api/stories" && m === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.user_id, s.kind, s.text, s.background, s.width, s.height, s.created_at, s.expires_at,
              u.username, u.display_name, u.avatar_version,
              EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.user_id = ?1) AS viewed,
              (SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id) AS views
         FROM stories s JOIN users u ON u.id = s.user_id
        WHERE s.expires_at > ?2 AND (s.user_id = ?1 OR s.user_id IN (${CONTACTS}))
        ORDER BY s.created_at`,
    )
      .bind(me.id, now)
      .all<StoryRow>();
    const groups = new Map<string, StoryGroup>();
    for (const r of results) {
      const user: User = toUser({ id: r.user_id, username: r.username, display_name: r.display_name, avatar_version: r.avatar_version });
      const g = groups.get(r.user_id) ?? { user, stories: [], unseen: false };
      const mine = r.user_id === me.id;
      const story: Story = {
        id: r.id,
        userId: r.user_id,
        kind: r.kind,
        text: r.text,
        background: r.background,
        width: r.width,
        height: r.height,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        viewed: r.viewed === 1 || mine,
        ...(mine ? { views: r.views } : {}),
      };
      g.stories.push(story);
      if (!story.viewed) g.unseen = true;
      groups.set(r.user_id, g);
    }
    const list = [...groups.values()].sort((a, b) => {
      if (a.user.id === me.id) return -1;
      if (b.user.id === me.id) return 1;
      if (a.unseen !== b.unseen) return a.unseen ? -1 : 1;
      return b.stories[b.stories.length - 1].createdAt - a.stories[a.stories.length - 1].createdAt;
    });
    return json({ groups: list });
  }

  // Post a story: JSON for text, raw image bytes (?w=&h=&text=) for a photo.
  if (path === "/api/stories" && m === "POST") {
    await assertAllowed(env, me.id, "stories");
    if ((request.headers.get("Content-Type") ?? "").startsWith("image/")) await assertAllowed(env, me.id, "uploads");
    await rateLimit(env, `story:${me.id}`, 30, DAY);
    const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM stories WHERE user_id = ?1 AND expires_at > ?2").bind(me.id, now).first<{ n: number }>();
    if ((live?.n ?? 0) >= LIMITS.storiesMax) throw new HttpError(400, `You can have up to ${LIMITS.storiesMax} stories at a time.`);
    const id = crypto.randomUUID();
    const isImage = (request.headers.get("Content-Type") ?? "").startsWith("image/");
    if (isImage) {
      const width = Math.round(Number(url.searchParams.get("w")));
      const height = Math.round(Number(url.searchParams.get("h")));
      if (!(width > 0 && width <= 4096 && height > 0 && height <= 4096)) throw new HttpError(400, "Invalid photo size.");
      const caption = (url.searchParams.get("text") ?? "").trim().slice(0, LIMITS.storyTextMax);
      const { bytes, mime } = await readUpload(request, "image", LIMITS.storyMaxBytes);
      await env.DB.prepare(
        "INSERT INTO stories (id, user_id, kind, text, mime, data, width, height, created_at, expires_at) VALUES (?1, ?2, 'image', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      )
        .bind(id, me.id, caption, mime, bytes, width, height, now, now + DAY)
        .run();
    } else {
      const body = await readJson<{ text?: unknown; background?: unknown }>(request);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new HttpError(400, "Write something first.");
      if ([...text].length > LIMITS.storyTextMax) throw new HttpError(400, `Stories can be at most ${LIMITS.storyTextMax} characters.`);
      const background = (STORY_BACKGROUNDS as readonly string[]).includes(body.background as string) ? (body.background as string) : STORY_BACKGROUNDS[0];
      await env.DB.prepare("INSERT INTO stories (id, user_id, kind, text, background, created_at, expires_at) VALUES (?1, ?2, 'text', ?3, ?4, ?5, ?6)")
        .bind(id, me.id, text, background, now, now + DAY)
        .run();
    }
    return json({ id });
  }

  const match = path.match(/^\/api\/stories\/([^/]+)(\/media|\/view|\/viewers)?$/);
  if (!match || !ID_RE.test(match[1])) throw new HttpError(404, "Not found.");
  const storyId = match[1];
  const story = await env.DB.prepare("SELECT user_id, mime, expires_at FROM stories WHERE id = ?1")
    .bind(storyId)
    .first<{ user_id: string; mime: string | null; expires_at: number }>();
  if (!story || story.expires_at <= now || !(await canSee(env, me.id, story.user_id))) {
    throw new HttpError(404, "This story is no longer available.");
  }
  const sub = match[2];

  if (sub === "/media" && m === "GET") {
    const row = await env.DB.prepare("SELECT data FROM stories WHERE id = ?1").bind(storyId).first<{ data: ArrayBuffer | number[] | null }>();
    if (!row?.data || !story.mime) throw new HttpError(404, "No photo.");
    const bytes = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
    return new Response(bytes, { headers: mediaHeaders(story.mime, "immutable") });
  }
  if (sub === "/view" && m === "POST") {
    if (story.user_id !== me.id) {
      await env.DB.prepare("INSERT OR IGNORE INTO story_views (story_id, user_id, viewed_at) VALUES (?1, ?2, ?3)").bind(storyId, me.id, now).run();
    }
    return json({ ok: true });
  }
  if (sub === "/viewers" && m === "GET") {
    if (story.user_id !== me.id) throw new HttpError(403, "Only you can see who viewed your story.");
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_version, v.viewed_at
         FROM story_views v JOIN users u ON u.id = v.user_id WHERE v.story_id = ?1 ORDER BY v.viewed_at DESC`,
    )
      .bind(storyId)
      .all<{ id: string; username: string; display_name: string; avatar_version: number | null; viewed_at: number }>();
    return json({ viewers: results.map((r) => ({ user: toUser(r), viewedAt: r.viewed_at })) });
  }
  if (!sub && m === "DELETE") {
    if (story.user_id !== me.id) throw new HttpError(403, "You can only delete your own stories.");
    await env.DB.prepare("DELETE FROM stories WHERE id = ?1").bind(storyId).run();
    return json({ ok: true });
  }
  throw new HttpError(404, "Not found.");
}

/** Cron: stories older than 24 hours are deleted for good. */
export async function expireStories(env: Env): Promise<number> {
  const r = await env.DB.prepare("DELETE FROM stories WHERE expires_at <= ?1").bind(Date.now()).run();
  return r.meta.changes ?? 0;
}
