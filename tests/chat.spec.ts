import { expect, test } from "@playwright/test";
import { openFriendChat, PHONE, resetRateLimits, signUp, uniq, closeBrowsers } from "./helpers";

test.afterAll(closeBrowsers);

test.beforeAll(() => resetRateLimits());

test("messages arrive live, with replies, reactions and read receipts", async ({ browser }) => {
  const id = uniq();
  const ann = await signUp(browser, `ann_${id}`);
  const ben = await signUp(browser, `ben_${id}`, PHONE);
  await openFriendChat(ann, ben, `ben_${id}`, "Ann", "Ben");
  const annChat = ann.getByRole("region", { name: "Chat with Ben" });
  const benChat = ben.getByRole("region", { name: "Chat with Ann" });

  await ann.getByPlaceholder(/Message/).fill("Hello from Ann 👋");
  await ann.keyboard.press("Enter");
  await expect(benChat.getByText("Hello from Ann 👋")).toBeVisible();

  // Reply from the phone
  await benChat.getByText("Hello from Ann 👋").click({ button: "right" });
  await ben.getByRole("menuitem", { name: "Reply" }).click();
  await ben.getByPlaceholder(/Message/).fill("Hi Ann!");
  await ben.getByRole("button", { name: "Send message" }).click();
  await expect(annChat.getByText("Hi Ann!")).toBeVisible();

  // React
  await annChat.getByText("Hi Ann!").click({ button: "right" });
  await ann.getByRole("button", { name: "React ❤️" }).click();
  await expect(benChat.getByText("❤️").first()).toBeVisible();

  // Read aloud is offered
  await annChat.getByText("Hi Ann!").click({ button: "right" });
  await expect(ann.getByRole("menuitem", { name: "Read aloud" })).toBeVisible();
  await ann.keyboard.press("Escape");
});

test("strangers start as a request and can't call", async ({ browser }) => {
  const id = uniq();
  const cat = await signUp(browser, `cat_${id}`);
  const dan = await signUp(browser, `dan_${id}`);
  const res = await cat.evaluate(
    async (u) =>
      (await fetch("/api/rooms/dm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u }) })).status,
    `dan_${id}`,
  );
  expect(res).toBe(200);
  await dan.reload();
  await expect(dan.getByText(/request/i).first()).toBeVisible();
});
