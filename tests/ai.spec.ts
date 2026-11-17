import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { closeBrowsers, openFriendChat, PHONE, resetRateLimits, signUp, uniq } from "./helpers";

/*
 * Voice transcripts and translation run on Cloudflare Workers AI, which needs a
 * Cloudflare login (and uses the free daily allowance), so this file only runs
 * locally, never in CI.
 */
test.skip(!!process.env.CI, "Workers AI needs a Cloudflare login");

// The fake microphone "says" this sentence (made with Windows' text-to-speech):
// "Hello Ben. Let's meet at the train station tomorrow at seven in the morning."
const SPEECH = fileURLToPath(new URL("./fixtures/speech.wav", import.meta.url));
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      `--use-file-for-fake-audio-capture=${SPEECH}`,
    ],
  },
});

test.beforeAll(() => resetRateLimits());
test.afterAll(closeBrowsers);

test("transcribe a voice message and translate messages", async ({ browser }) => {
  test.setTimeout(180_000);
  const id = uniq();
  const ann = await signUp(browser, `ann_${id}`);
  const ben = await signUp(browser, `ben_${id}`, PHONE);
  await openFriendChat(ann, ben, `ben_${id}`, "Ann", "Ben");
  const benChat = ben.getByRole("region", { name: "Chat with Ann" });

  // Ann records a real voice message (the fake mic plays the sentence)
  await ann.getByRole("button", { name: "Record a voice message" }).click();
  await ann.waitForTimeout(7000);
  await ann.getByRole("button", { name: "Send voice message" }).click();

  // Ben reads it instead of listening
  await benChat.getByRole("button", { name: "Show the text of this voice message" }).click();
  await expect(benChat.getByText(/train station/i)).toBeVisible({ timeout: 60_000 });

  // Ben translates a text message into French
  await ben.evaluate(async () => {
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { translateTo: "fr" } }),
    });
  });
  await ben.reload();
  await ben.getByRole("button", { name: /Ann/ }).first().click();
  await ann.getByPlaceholder(/Message/).fill("Good morning! I will bring the coffee.");
  await ann.keyboard.press("Enter");
  await benChat.getByText("Good morning! I will bring the coffee.").click({ button: "right" });
  await ben.getByRole("menuitem", { name: "Translate" }).click();
  await expect(benChat.getByText(/Bonjour|café/i)).toBeVisible({ timeout: 60_000 });

  // The voice message too (from its transcript)
  await benChat.getByText(/train station/i).click({ button: "right" });
  await ben.getByRole("menuitem", { name: "Translate" }).click();
  await expect(benChat.getByText(/gare/i)).toBeVisible({ timeout: 60_000 });
  await ben.screenshot({ path: "test-results/ai.png" });
});
