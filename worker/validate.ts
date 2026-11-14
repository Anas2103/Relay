import { passwordProblem } from "../shared/password";
import { LIMITS } from "../shared/types";
import { HttpError } from "./http";

const USERNAME_RE = new RegExp(`^[a-zA-Z0-9_]{${LIMITS.usernameMin},${LIMITS.usernameMax}}$`);

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function validUsername(raw: unknown): string {
  const username = str(raw).trim();
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(
      400,
      `Username must be ${LIMITS.usernameMin}–${LIMITS.usernameMax} characters: letters, numbers or _.`,
    );
  }
  return username;
}



export function validPassword(raw: unknown, username = ""): string {
  const password = str(raw);
  const problem = passwordProblem(password, username);
  if (problem) throw new HttpError(400, problem);
  return password;
}

/** Returns the trimmed display name, or `fallback` when empty. */
export function validDisplayName(raw: unknown, fallback: string): string {
  const name = str(raw).trim();
  if (name.length > LIMITS.displayNameMax) {
    throw new HttpError(400, `Display name must be at most ${LIMITS.displayNameMax} characters.`);
  }
  return name || fallback;
}

export function isUniqueViolation(err: unknown): boolean {
  return String(err).includes("UNIQUE");
}
