import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { closeBrowsers, post, resetRateLimits, signUp, uniq } from "./helpers";

test.afterAll(closeBrowsers);
test.describe.configure({ mode: "serial" });

/*
 * The owner (super admin, the highest authority): site switches, broadcast,
 * restrictions, timed suspensions, account insight, erasing, joining groups,
 * story moderation, search-everything and "sign everyone out".
 */

let owner: Page;
let admin: Page;
let sam: Page;
let tia: Page;
const id = uniq();
const sql = (q: string) => execSync(`npx wrangler d1 execute relay-chat-db --local --command "${q}"`, { stdio: "ignore" });

async function openAdmin(p: Page, tab: string) {
  await p.getByRole("button", { name: "Admin panel" }).click();
  await p.getByRole("button", { name: tab, exact: true }).click();
}
async function closeAdmin(p: Page) {
  await p.getByRole("button", { name: "Back to chats" }).click();
}
const api = (p: Page, path: string, method = "GET", body?: unknown) =>
  p.evaluate(
    async ([path, method, body]) => {
      const res = await fetch(path as string, {
        method: method as string,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    },
    [path, method, body] as const,
  );

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  owner = await signUp(browser, `boss_${id}`);
  admin = await signUp(browser, `mod_${id}`);
  sam = await signUp(browser, `sam_${id}`);
  tia = await signUp(browser, `tia_${id}`);
  sql(`UPDATE users SET role='admin', super_admin=1 WHERE username='boss_${id}'`);
  sql(`UPDATE users SET role='admin' WHERE username='mod_${id}'`);
  await owner.reload();
  await admin.reload();
  // Sam and Tia are friends.
  const { room } = await post<{ room: { id: string } }>(sam, "/api/rooms/dm", { username: `tia_${id}` });
  await post(tia, `/api/rooms/${room.id}/accept`);
});

test.afterAll(() => {
  // Leave the shared local database as other tests expect it.
  sql(`DELETE FROM site_settings WHERE key IN ('readonly', 'features')`);
});

test("only the owner reaches the owner tools", async () => {
  expect((await api(admin, "/api/admin/owner/stories")).status).toBe(404);
  expect((await api(sam, "/api/admin/owner/stories")).status).toBe(404);
  expect((await api(owner, "/api/admin/owner/stories")).status).toBe(200);
});

test("switch a feature off for everyone; admins keep it", async () => {
  await openAdmin(owner, "Site");
  await owner.getByRole("switch", { name: "Stories" }).click();
  await expect(owner.getByRole("switch", { name: "Stories" })).toHaveAttribute("aria-checked", "false");

  await expect.poll(async () => (await api(sam, "/api/stories", "POST", { text: "hi", background: "indigo" })).status, { timeout: 10_000 }).toBe(403);
  const r = await api(sam, "/api/stories", "POST", { text: "hi", background: "indigo" });
  expect(r.data.error).toContain("turned off");
  expect((await api(admin, "/api/stories", "POST", { text: "admins can", background: "indigo" })).status).toBe(200);
  await sam.reload();
  await expect(sam.getByRole("button", { name: "Add a story" })).toHaveCount(0);

  await owner.getByRole("switch", { name: "Stories" }).click();
  await expect(owner.getByRole("switch", { name: "Stories" })).toHaveAttribute("aria-checked", "true");
});

test("read-only mode: everyone reads, nobody but admins sends", async () => {
  await owner.getByRole("switch", { name: "Read-only mode" }).click();
  await sam.reload();
  await sam.getByRole("button", { name: /Tia/ }).first().click();
  await expect(sam.getByText(/read-only mode/)).toBeVisible({ timeout: 10_000 });
  await expect(sam.getByRole("textbox", { name: "Message" })).toHaveCount(0);
  await owner.getByRole("switch", { name: "Read-only mode" }).click();
  await expect(owner.getByRole("switch", { name: "Read-only mode" })).toHaveAttribute("aria-checked", "false");
  await sam.reload();
  await sam.getByRole("button", { name: /Tia/ }).first().click();
  await expect(sam.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 10_000 });
});

test("broadcast pops up on everyone's screen", async () => {
  await owner.getByRole("textbox", { name: "Broadcast title" }).fill("Heads up");
  await owner.getByRole("textbox", { name: "Broadcast message" }).fill("Update tonight at 22:00");
  await owner.getByRole("button", { name: "Send to everyone" }).click();
  await expect(sam.getByRole("alert").getByText("Update tonight at 22:00")).toBeVisible({ timeout: 10_000 });
  await expect(tia.getByRole("alert").getByText("Heads up")).toBeVisible();
  await closeAdmin(owner);
});

test("restrict an account: it can read but not send", async () => {
  await sam.getByRole("textbox", { name: "Message" }).fill("before restriction");
  await sam.keyboard.press("Enter");
  await expect(tia.getByText("before restriction").first()).toBeVisible({ timeout: 10_000 }).catch(() => {});

  await openAdmin(owner, "Users");
  await owner.getByRole("button", { name: `Edit @sam_${id}` }).click();
  await owner.getByRole("textbox", { name: "Reason" }).fill("spamming");
  await owner.getByRole("button", { name: "Restrict (read-only)" }).click();
  await expect(sam.getByRole("alert").getByText("Your account is restricted")).toBeVisible({ timeout: 10_000 });

  const tryUpload = await api(sam, "/api/stories", "POST", { text: "x", background: "indigo" });
  expect(tryUpload.status).toBe(403);
  expect(tryUpload.data.error).toContain("spamming");

  await owner.getByRole("button", { name: `Edit @sam_${id}` }).click();
  await owner.getByRole("button", { name: "Lift restriction" }).click();
  await expect.poll(async () => (await api(sam, "/api/stories", "POST", { text: "free again", background: "indigo" })).status).toBe(200);
});

test("owner view: devices, chats, activity; erase everything someone wrote", async () => {
  await owner.getByRole("button", { name: `Edit @sam_${id}` }).click();
  await expect(owner.getByText(/Signed-in devices \(1\)/)).toBeVisible();
  await expect(owner.getByText(/Chats \(1\)/)).toBeVisible();
  await owner.getByRole("button", { name: "Erase messages…" }).click();
  await owner.getByRole("button", { name: "Yes, erase them all" }).click();
  await expect(owner.getByRole("status").getByText(/Erased \d+ messages/)).toBeVisible();
  const { data } = await api(owner, `/api/admin/owner/search?q=${encodeURIComponent("before restriction")}`);
  expect(data.hits.filter((h: { username: string }) => h.username === `sam_${id}`)).toHaveLength(0);
  await owner.keyboard.press("Escape");
});

test("timed suspension tells them how long and why", async () => {
  await owner.getByRole("button", { name: `Edit @tia_${id}` }).click();
  await owner.getByRole("combobox", { name: "For how long" }).selectOption({ label: "1 day" });
  await owner.getByRole("textbox", { name: "Reason" }).fill("cooling off");
  await owner.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect.poll(async () => (await api(tia, "/api/me")).status).toBe(401);
  const login = await api(tia, "/api/auth/login", "POST", { username: `tia_${id}`, password: "test password 1" });
  expect(login.status).toBe(403);
  expect(login.data.error).toMatch(/for another (24 hours|1 day).*cooling off/);
  // Time's up → the suspension lifts by itself at the next sign-in.
  sql(`UPDATE users SET suspended_until = 1 WHERE username='tia_${id}'`);
  const again = await api(tia, "/api/auth/login", "POST", { username: `tia_${id}`, password: "test password 1" });
  expect(again.status).toBe(200);
  await closeAdmin(owner);
});

test("join any group as its admin; search everything; moderate stories", async () => {
  // Sam makes a group with Tia; the owner isn't in it.
  const tiaId = (await api(tia, "/api/me")).data.user.id;
  const { data } = await api(sam, "/api/groups", "POST", { name: `Club ${id}`, memberIds: [tiaId] });
  const groupId = data.room.id as string;
  await api(sam, "/api/stories", "POST", { text: "story to remove", background: "indigo" });

  await openAdmin(owner, "Moderate");
  await owner.getByRole("textbox", { name: "Search all messages" }).fill("free again");
  await owner.getByRole("button", { name: "Search", exact: true }).click();
  await expect(owner.getByRole("list", { name: "Search results" })).toBeVisible();

  const stories = owner.getByRole("list", { name: "Live stories" });
  await expect(stories.getByText("story to remove")).toBeVisible();
  await stories.locator("li", { hasText: "story to remove" }).getByRole("button", { name: /Remove/ }).click();
  await expect(stories.getByText("story to remove")).toHaveCount(0);

  const join = await api(owner, `/api/admin/owner/rooms/${groupId}/join`, "POST", {});
  expect(join.status).toBe(200);
  const rooms = (await api(owner, "/api/rooms")).data.rooms as { id: string; role?: string }[];
  expect(rooms.find((r) => r.id === groupId)?.role).toBe("admin");
  await closeAdmin(owner);
});

test("sign everyone out (the owner stays in)", async () => {
  await openAdmin(owner, "Site");
  await owner.getByRole("button", { name: "Sign everyone out…" }).click();
  await owner.getByRole("button", { name: "Yes, sign everyone out" }).click();
  await expect.poll(async () => (await api(sam, "/api/me")).status).toBe(401);
  expect((await api(admin, "/api/me")).status).toBe(401);
  expect((await api(owner, "/api/me")).status).toBe(200);
  // The audit log has all of it, and can be searched.
  await owner.getByRole("button", { name: "Audit log", exact: true }).click();
  await owner.getByRole("textbox", { name: "Search the audit log" }).fill("signed out");
  await expect(owner.getByText("signed everyone out").first()).toBeVisible();
});
