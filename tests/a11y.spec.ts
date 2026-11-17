import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { closeBrowsers, openFriendChat, PHONE, resetRateLimits, signUp, uniq } from "./helpers";

test.afterAll(closeBrowsers);

/*
 * Automated accessibility checks (axe-core, WCAG 2.2 A and AA rules) on the main
 * screens, in light and dark mode and on a phone. Automated checks catch roughly a
 * third of real issues; docs/ACCESSIBILITY.md lists the manual checks too.
 */

async function expectAccessible(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const summary = violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 120)}`));
  expect(summary, `${screen} has accessibility problems`).toEqual([]);
}

test("sign-in, sign-up and legal pages", async ({ page }) => {
  await page.goto("/");
  await expectAccessible(page, "sign in");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expectAccessible(page, "sign up");
  await page.goto("/legal/privacy.html");
  await expectAccessible(page, "privacy policy");
});

test("chat, settings and the phone layout", async ({ browser }) => {
  resetRateLimits();
  const id = uniq();
  const light = await signUp(browser, `axa_${id}`);
  const dark = await signUp(browser, `axb_${id}`, { colorScheme: "dark" });
  await openFriendChat(light, dark, `axb_${id}`, "Axa", "Axb");
  await light.getByRole("textbox", { name: "Message" }).fill("hello");
  await light.keyboard.press("Enter");
  await dark.getByText("hello").first().waitFor();
  await expectAccessible(light, "chat (light)");
  await expectAccessible(dark, "chat (dark)");
  await light.getByRole("navigation", { name: "Spaces" }).getByRole("button", { name: "Settings" }).click();
  await expectAccessible(light, "settings");
  const phone = await signUp(browser, `axc_${id}`, PHONE);
  await expectAccessible(phone, "chat list (phone)");
});
