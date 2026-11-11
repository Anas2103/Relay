import type { User } from "../shared/types";
import { hashPassword, rateLimit, requireUser, revokeOtherSessions, verifyPassword } from "./auth";
import type { Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { str, validDisplayName, validPassword } from "./validate";

const FIFTEEN_MIN = 15 * 60 * 1000;

/** Self-service account settings for the signed-in user. */
export async function routeAccount(request: Request, env: Env, url: URL): Promise<Response> {
  const me = await requireUser(request, env);
  const p = url.pathname;
  const m = request.method;

  if (p === "/api/account" && m === "PATCH") return updateProfile(request, env, me);
  if (p === "/api/account/password" && m === "POST") return changePassword(request, env, me);

  throw new HttpError(404, "Not found.");
}

async function updateProfile(request: Request, env: Env, me: User): Promise<Response> {
  const body = await readJson<{ displayName?: unknown }>(request);
  const displayName = validDisplayName(body.displayName, me.username);
  await env.DB.prepare("UPDATE users SET display_name = ?1 WHERE id = ?2").bind(displayName, me.id).run();
  return json({ user: { ...me, displayName } });
}

async function changePassword(request: Request, env: Env, me: User): Promise<Response> {
  // Stops someone with a stolen session from brute-forcing the current password.
  await rateLimit(env, `password-change:${me.id}`, 5, FIFTEEN_MIN);

  const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request);
  const currentPassword = str(body.currentPassword);
  const newPassword = validPassword(body.newPassword);

  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1")
    .bind(me.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    throw new HttpError(400, "Your current password is incorrect.");
  }
  if (currentPassword === newPassword) {
    throw new HttpError(400, "Your new password must be different from the current one.");
  }

  await env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2")
    .bind(await hashPassword(newPassword), me.id)
    .run();
  await revokeOtherSessions(env, request, me.id);
  return json({ ok: true });
}
