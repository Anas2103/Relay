import { expect, test } from "@playwright/test";
import { openFriendChat, PHONE, resetRateLimits, signUp, uniq, closeBrowsers } from "./helpers";

test.afterAll(closeBrowsers);

// Runs against the production build (the service worker caches its app shell).
test.use({ baseURL: "http://localhost:4173" });
test.beforeAll(() => resetRateLimits());

test("opens with no internet, shows saved chats, and sends what you wrote once back online", async ({ browser }) => {
  const id = uniq();
  const ann = await signUp(browser, `ann_${id}`, PHONE);
  const ben = await signUp(browser, `ben_${id}`);
  await openFriendChat(ben, ann, `ann_${id}`, "Ben", "Ann");
  const benChat = ben.getByRole("region", { name: "Chat with Ann" });
  const annChat = ann.getByRole("region", { name: "Chat with Ben" });

  await ben.getByPlaceholder(/Message/).fill("Read this on the train 🚆");
  await ben.keyboard.press("Enter");
  await expect(annChat.getByText("Read this on the train 🚆")).toBeVisible();
  await ann.reload(); // the service worker now controls the page and has the app cached
  await ann.getByRole("button", { name: /Ben/ }).first().waitFor();
  await ann.waitForTimeout(1000);

  // ---- No internet ----
  await ann.context().setOffline(true);
  await ann.reload();
  await expect(ann.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
  await ann.getByRole("button", { name: /Ben/ }).first().click();
  await expect(annChat.getByText("Read this on the train 🚆")).toBeVisible();

  // Write while offline: it waits instead of failing
  await ann.getByPlaceholder(/Message/).fill("Replying from a tunnel");
  await ann.getByRole("button", { name: "Send message" }).click();
  await expect(annChat.getByText("Replying from a tunnel")).toBeVisible();
  await ann.waitForTimeout(21_000); // longer than the old 20 s give-up
  await expect(annChat.getByText(/Failed|Tap to retry/i)).toHaveCount(0);

  // ---- Back online ----
  await ann.context().setOffline(false);
  await ann.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(benChat.getByText("Replying from a tunnel")).toBeVisible({ timeout: 30_000 });
  await expect(ann.getByRole("status").filter({ hasText: "Offline" })).toHaveCount(0);
});

test("signing out wipes the offline copy", async ({ browser }) => {
  const page = await signUp(browser, `wipe_${uniq()}`);
  await page.waitForTimeout(800);
  const before = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const r = indexedDB.open("relay-offline");
        r.onsuccess = () => {
          const c = r.result.transaction("cache").objectStore("cache").count();
          c.onsuccess = () => resolve(c.result);
        };
      }),
  );
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("dialog").filter({ hasText: "Sign out?" }).getByRole("button", { name: "Sign out" }).click();
  await page
    .getByRole("button", { name: "Create account" })
    .or(page.getByRole("button", { name: "Sign in" }))
    .first()
    .waitFor();
  const after = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const r = indexedDB.open("relay-offline");
        r.onsuccess = () => {
          const c = r.result.transaction("cache").objectStore("cache").count();
          c.onsuccess = () => resolve(c.result);
        };
      }),
  );
  expect(after).toBe(0);
});
