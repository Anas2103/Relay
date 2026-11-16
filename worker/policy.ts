import { SITE_FEATURES, type SiteFeature } from "../shared/types";
import type { Env } from "./env";
import { readSiteSettings } from "./features";
import { HttpError } from "./http";

/*
 * What a person may do right now, decided in one place:
 *  - the owner's site switches (read-only mode, features turned off for everyone),
 *  - a restriction on their account (can read, can't send/call/upload/post until a time).
 * Admins (and the owner) are never blocked, so they can keep moderating.
 */

export type Action = SiteFeature | "send";

const VERB: Record<Action, string> = {
  send: "send messages",
  calls: "make calls",
  secretChats: "start secret chats",
  stories: "post stories",
  uploads: "send photos, videos, voice notes or files",
  groups: "create groups",
  newChats: "start new chats",
  ai: "use AI transcripts and translation",
  chill: "use Chill",
};

/** "2 hours", "3 days"… */
export function humanWait(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** Why this person can't do `action` right now, or null if they can. */
export async function policyBlock(env: Env, userId: string, action: Action): Promise<string | null> {
  const user = await env.DB.prepare("SELECT role, restricted_until, restrict_reason FROM users WHERE id = ?1")
    .bind(userId)
    .first<{ role: string; restricted_until: number | null; restrict_reason: string | null }>();
  if (!user) return "Please sign in.";
  if (user.role === "admin") return null;

  if (user.restricted_until && user.restricted_until > Date.now()) {
    const why = user.restrict_reason ? ` Reason: ${user.restrict_reason}` : "";
    return `Your account is restricted for another ${humanWait(user.restricted_until - Date.now())}: you can read, but not ${VERB[action]}.${why}`;
  }

  const site = await readSiteSettings(env);
  // Read-only stops people sending things; watching and listening are fine.
  if (site.readOnly && action !== "ai" && action !== "chill") return "Relay is in read-only mode right now. You can read your chats, but not send anything.";
  if (action !== "send" && !site.features[action]) {
    const label = SITE_FEATURES.find(([k]) => k === action)?.[1] ?? "This feature";
    return `${label}: turned off for everyone for now.`;
  }
  return null;
}

/** Throws a 403 with the reason when the action isn't allowed. */
export async function assertAllowed(env: Env, userId: string, action: Action): Promise<void> {
  const why = await policyBlock(env, userId, action);
  if (why) throw new HttpError(403, why);
}

/** Lifts timed suspensions whose time is up (run by the cron and before each sign-in). */
export async function liftExpiredSuspensions(env: Env): Promise<number> {
  const r = await env.DB.prepare(
    "UPDATE users SET suspended_at = NULL, suspended_until = NULL, suspend_reason = NULL WHERE suspended_at IS NOT NULL AND suspended_until IS NOT NULL AND suspended_until <= ?1",
  )
    .bind(Date.now())
    .run();
  return r.meta.changes ?? 0;
}

/** Throws the "suspended" error (with how long and why) if the account is still suspended. */
export async function assertNotSuspended(env: Env, userId: string): Promise<void> {
  await liftExpiredSuspensions(env);
  const u = await env.DB.prepare("SELECT suspended_at, suspended_until, suspend_reason FROM users WHERE id = ?1")
    .bind(userId)
    .first<{ suspended_at: number | null; suspended_until: number | null; suspend_reason: string | null }>();
  if (!u) throw new HttpError(401, "Wrong username or password.");
  if (u.suspended_at === null) return;
  const time = u.suspended_until ? ` for another ${humanWait(u.suspended_until - Date.now())}` : "";
  const why = u.suspend_reason ? ` Reason: ${u.suspend_reason}` : "";
  throw new HttpError(403, `This account has been suspended${time}.${why}`);
}
