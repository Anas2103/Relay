import { assertAllowed } from "./policy";
import { LIMITS, type Sticker } from "../shared/types";
import { rateLimit, requireUser } from "./auth";
import type { Env } from "./env";
import { HttpError, json } from "./http";
import { mediaHeaders, readUpload } from "./media";

/*
 * Your own sticker collection. Stickers are small images (made in the browser
 * from a photo, max 512 px), kept with your account so they follow you to every
 * device. Sending one uploads it into the chat like any other photo.
 */

const ID_RE = /^[0-9a-f-]{36}$/;

export async function routeStickers(request: Request, env: Env, path: string): Promise<Response> {
  const me = await requireUser(request, env);
  const m = request.method;

  if (path === "/api/stickers" && m === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, width, height, created_at FROM stickers WHERE user_id = ?1 ORDER BY created_at DESC",
    )
      .bind(me.id)
      .all<{ id: string; width: number; height: number; created_at: number }>();
    return json({ stickers: results.map((r): Sticker => ({ id: r.id, width: r.width, height: r.height, createdAt: r.created_at })) });
  }

  if (path === "/api/stickers" && m === "POST") {
    await assertAllowed(env, me.id, "uploads");
    await rateLimit(env, `sticker:${me.id}`, 40, 15 * 60_000);
    const url = new URL(request.url);
    const width = Math.round(Number(url.searchParams.get("w")));
    const height = Math.round(Number(url.searchParams.get("h")));
    if (!(width > 0 && width <= 512 && height > 0 && height <= 512)) throw new HttpError(400, "Stickers can be up to 512 × 512.");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM stickers WHERE user_id = ?1").bind(me.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= LIMITS.stickersMax) throw new HttpError(400, `You can keep up to ${LIMITS.stickersMax} stickers. Remove some first.`);
    const { bytes, mime } = await readUpload(request, "image", LIMITS.stickerMaxBytes);
    const sticker: Sticker = { id: crypto.randomUUID(), width, height, createdAt: Date.now() };
    await env.DB.prepare("INSERT INTO stickers (id, user_id, mime, data, width, height, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(sticker.id, me.id, mime, bytes, width, height, sticker.createdAt)
      .run();
    return json({ sticker });
  }

  const match = path.match(/^\/api\/stickers\/([^/]+)$/);
  if (match && ID_RE.test(match[1])) {
    const id = match[1];
    if (m === "GET") {
      const row = await env.DB.prepare("SELECT mime, data FROM stickers WHERE id = ?1 AND user_id = ?2")
        .bind(id, me.id)
        .first<{ mime: string; data: ArrayBuffer | number[] }>();
      if (!row) throw new HttpError(404, "Sticker not found.");
      const bytes = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
      return new Response(bytes, { headers: mediaHeaders(row.mime, "immutable") });
    }
    if (m === "DELETE") {
      await env.DB.prepare("DELETE FROM stickers WHERE id = ?1 AND user_id = ?2").bind(id, me.id).run();
      return json({ ok: true });
    }
  }
  throw new HttpError(404, "Not found.");
}
