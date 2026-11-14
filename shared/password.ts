import { LIMITS } from "./types";

/** The most used passwords (and obvious variants) are refused outright. */
const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "12345678", "123456789", "1234567890",
  "11111111", "00000000", "qwertyuiop", "qwerty123", "qwertyui", "azertyuiop", "azerty123", "iloveyou", "iloveyou1",
  "sunshine", "princess", "football", "baseball", "superman", "starwars", "whatever", "trustno1", "letmein1",
  "welcome1", "welcome123", "admin123", "administrator", "abc12345", "abcd1234", "monkey123", "dragon123", "11223344",
  "12341234", "87654321", "a1b2c3d4", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "changeme", "computer", "internet",
  "michael1", "jennifer", "charlie1", "shadow12", "master12", "qazwsxedc", "asdfghjkl", "zxcvbnm1", "relay123",
]);

/** Why a password isn't allowed, or null when it's fine. The same rules run on the server. */
export function passwordProblem(password: string, username = ""): string | null {
  if (password.length < LIMITS.passwordMin) return `Password must be at least ${LIMITS.passwordMin} characters.`;
  if (password.length > LIMITS.passwordMax) return `Password can be at most ${LIMITS.passwordMax} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return "That password is too common. Pick something harder to guess.";
  if (username.length >= 3 && lower.includes(username.toLowerCase())) return "Your password can't contain your username.";
  if (new Set(password).size < 4) return "Use a mix of different characters.";
  return null;
}

/** 0 (weak) to 4 (very strong): a rough estimate from length and character variety. */
export function passwordStrength(password: string, username = ""): 0 | 1 | 2 | 3 | 4 {
  if (passwordProblem(password, username)) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const unique = new Set(password).size;
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (classes >= 3) score++;
  if (unique >= 8 && (classes >= 2 || password.length >= 16)) score++;
  return Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
}
