import { passwordProblem, passwordStrength } from "../../shared/password";
import { LIMITS } from "../../shared/types";

const LEVELS = [
  { label: "Too weak", bar: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  { label: "Weak", bar: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" },
  { label: "Okay", bar: "bg-amber-400", text: "text-amber-600 dark:text-amber-400" },
  { label: "Strong", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  { label: "Very strong", bar: "bg-emerald-600", text: "text-emerald-700 dark:text-emerald-400" },
];

/** Live meter under a new-password field, using the same rules as the server. */
export function PasswordStrength({ password, username = "" }: { password: string; username?: string }) {
  if (!password) {
    return <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">At least {LIMITS.passwordMin} characters. A short sentence is easy to remember and hard to guess.</p>;
  }
  const score = passwordStrength(password, username);
  const problem = passwordProblem(password, username);
  const level = LEVELS[score];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${score >= i ? level.bar : "bg-zinc-200 dark:bg-zinc-700"}`} />
        ))}
      </div>
      <p className={`mt-1.5 text-xs ${problem ? "text-red-600 dark:text-red-400" : level.text}`}>
        {problem ?? `${level.label}${score < 3 ? " — longer is better. Mix in capitals, numbers or symbols." : ""}`}
      </p>
    </div>
  );
}
