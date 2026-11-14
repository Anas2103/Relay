import { expect, test } from "@playwright/test";
import { openFriendChat, PHONE, resetRateLimits, signUp, uniq } from "./helpers";

test.beforeAll(() => resetRateLimits());

test("make a sticker, send it, and it shows without a bubble", async ({ browser }) => {
  const id = uniq();
  const ann = await signUp(browser, `ann_${id}`);
  const ben = await signUp(browser, `ben_${id}`, PHONE);
  await openFriendChat(ann, ben, `ben_${id}`, "Ann", "Ben");

  // A cut-out style picture: a red star on a transparent background.
  const png = await ann.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 300;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e11d48";
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 60 : 140;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      g.lineTo(150 + r * Math.cos(a), 150 + r * Math.sin(a));
    }
    g.fill();
    return c.toDataURL("image/png").split(",")[1];
  });

  await ann.getByRole("button", { name: "Stickers" }).click();
  const panel = ann.getByRole("dialog", { name: "Stickers" });
  await panel.locator('input[type="file"]').setInputFiles({ name: "star.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(panel.getByRole("button", { name: "Send sticker" })).toHaveCount(1);
  await panel.getByRole("button", { name: "Send sticker" }).click();

  const sticker = ben.getByRole("region", { name: "Chat with Ann" }).getByRole("img", { name: "Sticker" });
  await expect(sticker).toBeVisible();
  await expect.poll(() => sticker.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await ben.getByRole("button", { name: /Back/ }).first().click();
  await expect(ben.getByText("✨ Sticker").first()).toBeVisible();

  // Stickers follow you: the collection is on the account.
  const count = await ann.evaluate(async () => (await (await fetch("/api/stickers")).json()).stickers.length);
  expect(count).toBe(1);

  // Remove it again
  await ann.getByRole("button", { name: "Stickers" }).click();
  await panel.getByRole("button", { name: "Edit" }).click();
  await panel.getByRole("button", { name: "Remove sticker" }).click();
  await expect(panel.getByRole("button", { name: /sticker/i })).toHaveCount(1); // only "Add stickers…" is left
});

test("you can't read someone else's stickers", async ({ browser }) => {
  const id = uniq();
  const a = await signUp(browser, `own_${id}`);
  const b = await signUp(browser, `snoop_${id}`);
  const stickerId = await a.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    c.getContext("2d")!.fillRect(0, 0, 64, 64);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    const res = await fetch("/api/stickers?w=64&h=64", { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
    return (await res.json()).sticker.id as string;
  });
  const status = await b.evaluate(async (id) => (await fetch(`/api/stickers/${id}`)).status, stickerId);
  expect(status).toBe(404);
});
