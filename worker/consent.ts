import { ageOn, MIN_AGE, parseBirthDate, TERMS_VERSION } from "../shared/legal";
import type { SessionUser } from "./auth";
import { loadMe } from "./auth";
import type { Env } from "./env";
import { HttpError, json, readJson } from "./http";

/** Set after an under-age birth date was entered; holds no personal data. */
export const AGE_BLOCK_COOKIE = "relay_age_block";

export const UNDER_AGE_MESSAGE = `Sorry, you need to be at least ${MIN_AGE} to use Relay.`;

/**
 * Accept the current Terms and Privacy Policy (when they change, or for accounts
 * made before they existed). Older accounts also give their birth date here.
 */
export async function recordConsent(request: Request, env: Env, me: SessionUser): Promise<Response> {
  const body = await readJson<{ acceptTerms?: unknown; birthDate?: unknown }>(request);
  if (body.acceptTerms !== true) throw new HttpError(400, "Please accept the Terms of Service and Privacy Policy.");

  const row = await env.DB.prepare("SELECT birth_date FROM users WHERE id = ?1").bind(me.id).first<{ birth_date: string | null }>();
  let birthDate = row?.birth_date ?? null;
  if (birthDate === null) {
    birthDate = parseBirthDate(body.birthDate);
    if (!birthDate) throw new HttpError(400, "Enter your date of birth.");
    // An existing account that turns out to be under age is not deleted automatically:
    // it stays locked behind this screen until the owner reviews it.
    if (ageOn(birthDate) < MIN_AGE) throw new HttpError(403, `${UNDER_AGE_MESSAGE} Contact the site owner about your account.`);
  }

  await env.DB.prepare("UPDATE users SET birth_date = ?1, terms_version = ?2, terms_accepted_at = ?3 WHERE id = ?4")
    .bind(birthDate, TERMS_VERSION, Date.now(), me.id)
    .run();
  return json({ user: await loadMe(env, me.id) });
}
