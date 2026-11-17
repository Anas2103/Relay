import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { ADULT_BIRTH_DATE, closeBrowsers, resetRateLimits, signUp, uniq } from "./helpers";

test.afterAll(closeBrowsers);

/*
 * Age gate (checked on the server), terms acceptance, re-consent for older
 * accounts, what "export my data" contains, and the legal pages.
 */

test.beforeAll(() => resetRateLimits());

const sql = (q: string) => execSync(`npx wrangler d1 execute relay-chat-db --local --command "${q}"`, { stdio: "ignore" });

/** A date `years` years ago today (UTC). */
function yearsAgo(years: number, plusDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}

const register = (p: Page, body: Record<string, unknown>) =>
  p.evaluate(async (body) => {
    const res = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { error?: string } };
  }, body);

test("under-age sign-up is refused on the server, and retrying with another date is blocked for a day", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up" }).click();

  // The form starts with no birth date and an unticked agreement.
  await expect(page.locator("#birthDate")).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: /I agree to the Terms/ })).not.toBeChecked();

  const name = `kid_${uniq()}`;
  await page.fill("#username", name);
  await page.fill("#password", "test password 1");
  // One day short of 16.
  await page.fill("#birthDate", yearsAgo(16, 1));
  await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Sorry, you need to be at least 16 to use Relay.")).toBeVisible();

  // Changing the date straight away doesn't help.
  const retry = await register(page, { username: name, password: "test password 1", birthDate: ADULT_BIRTH_DATE, acceptTerms: true });
  expect(retry.status).toBe(403);

  // Nothing was stored: the username is still free for someone else.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto("/");
  const ok = await register(p2, { username: name, password: "test password 1", birthDate: ADULT_BIRTH_DATE, acceptTerms: true });
  expect(ok.status).toBe(201);
  await ctx.close();
  await other.close();
});

test("the server rejects missing terms, bad dates and future dates; exactly 16 today is allowed", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  const base = { password: "test password 1", acceptTerms: true };
  expect((await register(page, { ...base, username: `t_${uniq()}`, birthDate: ADULT_BIRTH_DATE, acceptTerms: false })).status).toBe(400);
  expect((await register(page, { ...base, username: `t_${uniq()}`, birthDate: "2001-02-30" })).status).toBe(400);
  expect((await register(page, { ...base, username: `t_${uniq()}`, birthDate: yearsAgo(-1) })).status).toBe(400);
  expect((await register(page, { ...base, username: `t_${uniq()}` })).status).toBe(400);
  expect((await register(page, { ...base, username: `t_${uniq()}`, birthDate: yearsAgo(16) })).status).toBe(201);
  await ctx.close();
});

test("older accounts accept the terms (and give a birth date) before continuing", async ({ browser }) => {
  const id = uniq();
  const page = await signUp(browser, `old_${id}`);
  sql(`UPDATE users SET terms_version = NULL, birth_date = NULL WHERE username = 'old_${id}'`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Before you continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();

  await page.fill("#consentBirthDate", yearsAgo(12));
  await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 16");

  await page.fill("#consentBirthDate", ADULT_BIRTH_DATE);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByPlaceholder("Search chats and people")).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder("Search chats and people")).toBeVisible();
});

test("export includes the birth date, terms acceptance and signed-in devices", async ({ browser }) => {
  const page = await signUp(browser, `exp_${uniq()}`);
  const data = await page.evaluate(async () => (await fetch("/api/account/export")).json());
  expect(data.profile.birth_date).toBe(ADULT_BIRTH_DATE);
  expect(data.profile.terms_version).toBeTruthy();
  expect(data.profile.terms_accepted_at).toBeGreaterThan(0);
  expect(data.profile).not.toHaveProperty("password_hash");
  expect(data.devices.length).toBeGreaterThan(0);
  expect(Array.isArray(data.blocked)).toBe(true);
});

test("legal pages are reachable from sign-up and from each other", async ({ page }) => {
  await page.goto("/");
  for (const [link, heading] of [
    ["Terms", "Terms of Service"],
    ["Privacy", "Privacy Policy"],
    ["Cookies", "Cookies & storage"],
    ["Guidelines", "Community Guidelines"],
    ["Accessibility", "Accessibility"],
    ["Help", "Help & FAQ"],
  ]) {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: link, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(/Last updated:/)).toBeVisible();
  }
  const txt = await page.request.get("/.well-known/security.txt");
  expect(txt.ok()).toBe(true);
  expect(await txt.text()).toContain("Contact:");
});
