/*
 * Age and terms rules shared by the app and the server. The server is the one
 * that enforces them; the app uses the same functions only to give early feedback.
 */

/**
 * Minimum age to use Relay. 16 is the highest "age of digital consent" in the EU
 * (GDPR art. 8) and avoids the parental-consent rules that apply to younger
 * children (e.g. COPPA under 13). Relay lets people message each other, so a
 * lower age would need extra protections for minors.
 */
export const MIN_AGE = 16;

/** Bump this (the date the Terms/Privacy Policy changed) to ask everyone to accept again. */
export const TERMS_VERSION = "2026-11-17";

/** How long someone who entered an under-age birth date must wait before trying again. */
export const AGE_BLOCK_SECONDS = 24 * 60 * 60;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD form, not in the future and not before 1900. Returns null otherwise. */
export function parseBirthDate(value: unknown, today = new Date()): string | null {
  if (typeof value !== "string") return null;
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Rejects things like 2001-02-30, which Date would quietly roll over.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (y < 1900 || date.getTime() > today.getTime()) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Full years between a YYYY-MM-DD birth date and `today` (UTC). */
export function ageOn(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}
