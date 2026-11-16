import { expect, test, type Page } from "@playwright/test";
import { closeBrowsers, post, resetRateLimits, signUp, uniq } from "./helpers";

test.afterAll(closeBrowsers);
test.describe.configure({ mode: "serial" });

let ann: Page;
let ben: Page;
let eve: Page;
const id = uniq();

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  ann = await signUp(browser, `ann_${id}`);
  ben = await signUp(browser, `ben_${id}`);
  eve = await signUp(browser, `eve_${id}`);
  const { room } = await post<{ room: { id: string } }>(ann, "/api/rooms/dm", { username: `ben_${id}` });
  await post(ben, `/api/rooms/${room.id}/accept`);
});

test("post a text story; contacts see it and you see who viewed it", async () => {
  await ann.reload();
  await ann.getByRole("button", { name: "Add a story" }).first().click();
  await ann.getByRole("textbox", { name: "Story text" }).fill("hello from a story");
  await ann.getByRole("button", { name: /Share for 24 hours/ }).click();
  await expect(ann.getByRole("button", { name: "View your story" })).toBeVisible({ timeout: 10_000 });

  // Ben (a contact) sees it as new and opens it.
  await ben.reload();
  await ben.getByRole("button", { name: /Ann's story \(new\)/ }).click();
  await expect(ben.getByRole("dialog", { name: "Ann's story" }).getByText("hello from a story")).toBeVisible();
  await ben.getByRole("button", { name: "Close stories" }).click();

  // Eve (not a contact) can't see it at all.
  const { groups } = await eve.evaluate(async () => (await fetch("/api/stories")).json());
  expect(groups.some((g: { user: { username: string } }) => g.user.username === `ann_${id}`)).toBe(false);

  // Ann sees Ben among the viewers.
  await expect
    .poll(async () => {
      const r = await ann.evaluate(async () => (await fetch("/api/stories")).json());
      return r.groups[0]?.stories[0]?.views;
    })
    .toBe(1);
});

test("delete your story", async () => {
  const { groups } = await ann.evaluate(async () => (await fetch("/api/stories")).json());
  const storyId = groups[0].stories[0].id;
  const status = await ann.evaluate(async (sid) => (await fetch(`/api/stories/${sid}`, { method: "DELETE" })).status, storyId);
  expect(status).toBe(200);
  const forBen = await ben.evaluate(async (sid) => (await fetch(`/api/stories/${sid}/view`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, storyId);
  expect(forBen).toBe(404);
});
