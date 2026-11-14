import { expect, test } from "@playwright/test";
import { openFriendChat, PHONE, resetRateLimits, signUp, uniq, closeBrowsers } from "./helpers";

test.afterAll(closeBrowsers);

test.beforeAll(() => resetRateLimits());

test("simple mode makes everything bigger, hides the extras and is remembered", async ({ browser }) => {
  const id = uniq();
  const page = await signUp(browser, `gran_${id}`, PHONE);
  const friend = await signUp(browser, `kid_${id}`);
  await openFriendChat(friend, page, `gran_${id}`, "Kid", "Gran");
  await page.getByRole("button", { name: /Back/ }).first().click();
  const fontSize = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--msg-size").trim());
  await expect(page.getByRole("tablist", { name: "Chat folders" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: /Appearance/ }).first().click();
  await page.getByRole("switch", { name: /Simple mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-simple", "on");
  expect(await fontSize()).toBe("19px");

  // Saved to the account: still on after a reload, applied before the app even starts
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-simple", "on");
  await expect(page.getByRole("button", { name: /Kid/ }).first()).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Chat folders" })).toBeHidden();
});
