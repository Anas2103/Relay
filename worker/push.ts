import { requireUser } from "./auth";
import type { Env } from "./env";
import { HttpError, json, readJson } from "./http";

/**
 * Web push with VAPID. Pushes carry NO payload: the browser's push service
 * (Google, Mozilla, Apple) only learns "something happened", and the service
 * worker shows a generic "New message" notification. Message text never leaves
 * our servers this way, and no payload encryption is needed.
 *
 * Push is optional: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY with
 * `wrangler secret put` (generate them with `node scripts/vapid-keys.mjs`).
 */

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function pushConfigured(env: Env): boolean {
  return !!env.VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY;
}

let signingKey: Promise<CryptoKey> | null = null;

function vapidKey(env: Env): Promise<CryptoKey> {
  signingKey ??= (async () => {
    const pub = fromB64url(env.VAPID_PUBLIC_KEY!);
    if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY must be an uncompressed P-256 point");
    const jwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      x: b64url(pub.slice(1, 33)),
      y: b64url(pub.slice(33, 65)),
      d: env.VAPID_PRIVATE_KEY!,
      ext: false,
    };
    return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  })();
  return signingKey;
}

async function vapidHeader(env: Env, endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(
    enc.encode(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: env.VAPID_SUBJECT || "https://relay-chat.bunbunchat.workers.dev",
      }),
    ),
  );
  const unsigned = `${header}.${payload}`;
  // WebCrypto returns the raw r||s signature, which is exactly what JWS ES256 expects.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidKey(env), enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** Sends an empty push to every device of the given users. Dead subscriptions are removed. */
export async function pushTo(env: Env, userIds: string[]): Promise<void> {
  if (!pushConfigured(env) || userIds.length === 0) return;
  const placeholders = userIds.map((_, i) => `?${i + 1}`).join(",");
  const { results } = await env.DB.prepare(`SELECT endpoint FROM push_subscriptions WHERE user_id IN (${placeholders})`)
    .bind(...userIds)
    .all<{ endpoint: string }>();
  await Promise.all(
    results.map(async ({ endpoint }) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: await vapidHeader(env, endpoint), TTL: "86400", Urgency: "high", "Content-Length": "0" },
        });
        if (res.status === 404 || res.status === 410) {
          await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1").bind(endpoint).run();
        }
      } catch (err) {
        console.error("push failed", err);
      }
    }),
  );
}

/** Push endpoints are only allowed on the well-known browser push services. */
function allowedEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname;
    return (
      h === "fcm.googleapis.com" ||
      h.endsWith(".push.services.mozilla.com") ||
      h.endsWith(".notify.windows.com") ||
      h === "web.push.apple.com" ||
      h.endsWith(".push.apple.com")
    );
  } catch {
    return false;
  }
}

export async function routePush(request: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = request.method;
  if (p === "/api/push/key" && m === "GET") {
    await requireUser(request, env);
    return json({ key: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : null });
  }
  const me = await requireUser(request, env);
  if (p === "/api/push/subscribe" && m === "POST") {
    if (!pushConfigured(env)) throw new HttpError(503, "Push notifications aren't set up on this server.");
    const body = await readJson<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>(request);
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
    const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
    if (!allowedEndpoint(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
      throw new HttpError(400, "Invalid push subscription.");
    }
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?1").bind(me.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= 10) {
      // Keep the 9 newest devices.
      await env.DB.prepare(
        "DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint NOT IN (SELECT endpoint FROM push_subscriptions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 9)",
      )
        .bind(me.id)
        .run();
    }
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
      .bind(endpoint, me.id, p256dh, auth, Date.now())
      .run();
    return json({ ok: true });
  }
  if (p === "/api/push/unsubscribe" && m === "POST") {
    const body = await readJson<{ endpoint?: unknown }>(request);
    if (typeof body.endpoint === "string") {
      await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1 AND user_id = ?2").bind(body.endpoint, me.id).run();
    }
    return json({ ok: true });
  }
  throw new HttpError(404, "Not found.");
}
