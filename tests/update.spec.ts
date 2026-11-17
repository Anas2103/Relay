import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { resetRateLimits, signUp, uniq, closeBrowsers } from "./helpers";

test.afterAll(closeBrowsers);

// Runs against the production build (only it has a build id and /version.json).
test.use({ baseURL: "http://localhost:4173" });
test.beforeAll(() => resetRateLimits());

const VERSION = "dist/client/version.json";

test("an open tab notices a new deploy, offers Reload, and switches over when hidden", async ({ browser }) => {
  const original = readFileSync(VERSION, "utf8");
  const page = await signUp(browser, `upd_${uniq()}`);
  try {
    await page.waitForTimeout(1500);
    await expect(page.getByText("Relay was updated")).toHaveCount(0);

    writeFileSync(VERSION, JSON.stringify({ build: "a-newer-build" })); // "deploy"
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText("Relay was updated")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

    await page
      .evaluate(() => {
        (window as unknown as { marker: number }).marker = 1;
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      })
      .catch(() => {}); // the page reloads right away, mid-command: that's the point
    // A fresh page has no marker (asked again until the reloaded page answers).
    await expect.poll(() => page.evaluate(() => (window as unknown as { marker?: number }).marker ?? "fresh").catch(() => "reloading")).toBe("fresh");
  } finally {
    writeFileSync(VERSION, original);
  }
});
