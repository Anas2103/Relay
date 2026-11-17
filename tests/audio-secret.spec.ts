import { expect, test, type Page } from "@playwright/test";
import { call, closeBrowsers, openFriendChat, PHONE, resetRateLimits, signUp, sleep, uniq } from "./helpers";

test.afterAll(closeBrowsers);
test.describe.configure({ mode: "serial" });

/*
 * Sound output on every platform, call audio quality, and encrypted photos in
 * secret chats (which disappear for good when the chat ends).
 */

let ann: Page;
let ben: Page;
const id = uniq();
let dmId = "";

/** An Android phone: no setSinkId, so the speaker is chosen through the phone's audio routes. */
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  ann = await signUp(browser, `ann_${id}`);
  ben = await signUp(browser, `ben_${id}`, { ...PHONE, userAgent: ANDROID_UA });
  await ben.context().addInitScript(() => {
    delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  });
  await ben.reload();
  await ben.getByPlaceholder("Search chats and people").waitFor();
});

test("Android phones get a sound output picker (speaker / earpiece / Bluetooth routes)", async () => {
  await ben.getByRole("button", { name: "Settings" }).first().click();
  await ben
    .getByRole("button", { name: /Voice & video/ })
    .first()
    .click();
  await expect(ben.getByText("Sound output", { exact: true })).toBeVisible();
  await expect(ben.getByText("Loudspeaker, phone earpiece, wired or Bluetooth headphones.")).toBeVisible();
  const group = ben.getByRole("radiogroup", { name: "Sound output" });
  // Names unlocked (fake mics) → Automatic + each route.
  await expect(group.getByRole("radio")).toHaveCount(3);
  await group.getByRole("radio").nth(2).click();
  const prefs = await ben.evaluate(() => JSON.parse(localStorage.getItem("relay:devices")!));
  expect(prefs.mic).toBeTruthy(); // on Android the route is chosen through the mic
  await expect(ben.getByRole("button", { name: "Play a test sound" })).toBeVisible();
  await group.getByRole("radio", { name: /Automatic/ }).click();
  await ben.keyboard.press("Escape");
});

test("in a call: output button, volume boost above 100%, studio voice quality", async () => {
  dmId = await openFriendChat(ann, ben, `ben_${id}`, "Ann", "Ben");
  await ann.getByRole("button", { name: "Voice call", exact: true }).click();
  await ben.getByText("Incoming voice call…").waitFor();
  await ben.getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => call(ann, "(c) => c.getState().phase"), { timeout: 20_000 }).toBe("active");
  await sleep(800);

  // The output button is on the call screen on every device (phones included).
  await ben.getByRole("button", { name: /Sound output/ }).click();
  const sheet = ben.getByRole("dialog", { name: "Sound output" });
  await expect(sheet.getByRole("radiogroup", { name: "Sound output" }).getByRole("radio")).toHaveCount(3);
  // Boost: runs through Web Audio, element stays at 100%.
  await sheet.locator('input[type="range"]').fill("180");
  await expect.poll(() => call(ben, "(c) => c.getState().outputRelayed")).toBe(true);
  expect(await ben.evaluate(() => document.querySelector("audio")!.volume)).toBe(1);
  // The other person's audio keeps arriving after the switch.
  const before = await call<number>(ben, "(c, s) => s.audioIn");
  await expect.poll(() => call<number>(ben, "(c, s) => s.audioIn")).toBeGreaterThan(before + 2000);
  // Back under 100%: plain playback with the element's volume.
  await sheet.locator('input[type="range"]').fill("60");
  await expect.poll(() => call(ben, "(c) => c.getState().outputRelayed")).toBe(false);
  expect(await ben.evaluate(() => document.querySelector("audio")!.volume)).toBeCloseTo(0.6);
  await sheet.getByRole("button", { name: "Close" }).click();

  // Opus is tuned (FEC, up to 128 kbps), and "Studio" raises the cap.
  expect(await call<string>(ann, "(c) => c.pc.localDescription.sdp")).toMatch(
    /useinbandfec=1.*maxaveragebitrate=128000|maxaveragebitrate=128000.*useinbandfec=1/,
  );
  expect(await call(ann, "(c) => c.audioSender.getParameters().encodings[0].maxBitrate")).toBe(48_000);
  await ann.getByRole("button", { name: /Call settings/ }).click();
  await ann.getByRole("dialog", { name: "Call settings" }).getByRole("tab", { name: "Noise & voice" }).click();
  await ann.getByRole("radio", { name: "Studio" }).click();
  await expect.poll(() => call(ann, "(c) => c.audioSender.getParameters().encodings[0].maxBitrate")).toBe(128_000);
  await ann.getByRole("dialog", { name: "Call settings" }).getByRole("button", { name: "Close" }).click();

  await ann.getByRole("button", { name: "End call" }).click();
  await sleep(1500);
  await ann
    .getByRole("button", { name: "Close" })
    .click({ timeout: 1000 })
    .catch(() => {});
  await ben
    .getByRole("button", { name: "Close" })
    .click({ timeout: 1000 })
    .catch(() => {});
});

/** A small real PNG, drawn in the page. */
async function makePng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e11d48";
    g.fillRect(0, 0, 320, 200);
    g.fillStyle = "#fde047";
    g.fillRect(40, 40, 120, 80);
    return c.toDataURL("image/png").split(",")[1];
  });
  return Buffer.from(b64, "base64");
}

let secretId = "";

test("secret chat: photos are encrypted on the device, the server only has ciphertext", async () => {
  // Ann starts a secret chat from Ben's info.
  await ann.getByRole("button", { name: /View Ben's info/ }).click();
  await ann.getByRole("button", { name: "Secret chat" }).click();
  await expect(ann.getByText(/Waiting for Ben|waiting/i).first()).toBeVisible({ timeout: 10_000 });

  // Ben accepts on his phone.
  await ben
    .getByRole("button", { name: "Back" })
    .first()
    .click()
    .catch(() => {});
  await ben
    .getByRole("button", { name: /Ben|Ann/ })
    .filter({ hasText: /secret/i })
    .first()
    .click()
    .catch(async () => {
      await ben
        .getByText(/secret chat/i)
        .first()
        .click();
    });
  await ben.getByRole("button", { name: /^Accept/ }).click();
  await expect(ben.getByPlaceholder("Encrypted message")).toBeVisible({ timeout: 15_000 });
  await expect(ann.getByPlaceholder("Encrypted message")).toBeVisible({ timeout: 15_000 });

  const { rooms } = await ann.evaluate(async () => (await fetch("/api/rooms")).json());
  secretId = rooms.find((r: { secret?: boolean; id: string }) => r.secret).id;

  // A plain photo can't be uploaded into a secret chat.
  const png = await makePng(ann);
  const plainStatus = await ann.evaluate(
    async ([roomId, b64]) => {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      return (await fetch(`/api/rooms/${roomId}/media?kind=image`, { method: "POST", body: bytes })).status;
    },
    [secretId, png.toString("base64")] as const,
  );
  expect(plainStatus).toBe(415);

  // Ann sends an encrypted photo with a caption.
  await ann.getByRole("button", { name: "Attach" }).click();
  await expect(ann.getByRole("menuitem", { name: "Encrypted photo" })).toBeVisible();
  await expect(ann.getByRole("menuitem", { name: "Document" })).toHaveCount(0);
  await ann.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: png });
  await ann.getByPlaceholder(/caption/i).fill("secret sunset");
  await ann.getByRole("button", { name: /^Send/ }).last().click();

  // Ben sees it decrypted (a blob: URL made on his phone) with the caption.
  const img = ben.locator('img[src^="blob:"]').first();
  await expect(img).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(ben.getByText("secret sunset")).toBeVisible();

  // What the server holds: an opaque, uncached container, no dimensions, ciphertext body.
  const server = await ben.evaluate(async (roomId) => {
    const { messages } = await (await fetch(`/api/rooms/${roomId}/messages`)).json();
    const m = messages.find((x: { kind: string }) => x.kind === "image");
    const res = await fetch(`/api/rooms/${roomId}/messages/${m.id}/media`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      body: m.body as string,
      meta: m.meta,
      magic: String.fromCharCode(...bytes.subarray(0, 4)),
      type: res.headers.get("content-type"),
      cache: res.headers.get("cache-control"),
      hasPng: String.fromCharCode(...bytes.subarray(16, 24)).includes("PNG"),
    };
  }, secretId);
  expect(server.body.startsWith("e2e1.")).toBe(true);
  expect(server.body).not.toContain("sunset");
  expect(server.meta.width).toBeUndefined();
  expect(server.magic).toBe("RLE1");
  expect(server.hasPng).toBe(false);
  expect(server.type).toBe("application/x-relay-e2e");
  expect(server.cache).toBe("no-store");
});

test("ending the secret chat erases it everywhere: messages, photos and both devices' keys", async () => {
  const keys = (p: Page) =>
    p.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const req = indexedDB.open("relay-e2e", 1);
          req.onsuccess = () => {
            const r = req.result.transaction("keys").objectStore("keys").count();
            r.onsuccess = () => resolve(r.result);
          };
          req.onerror = () => resolve(-1);
        }),
    );
  expect(await keys(ann)).toBe(1);
  expect(await keys(ben)).toBe(1);

  const { messages } = await ann.evaluate(async (roomId) => (await fetch(`/api/rooms/${roomId}/messages`)).json(), secretId);
  const photoId = messages.find((m: { kind: string }) => m.kind === "image").id;

  // Ann ends it from the chat's info.
  await ann.getByRole("button", { name: /View .*info/ }).click();
  await ann.getByRole("button", { name: "End secret chat" }).click();
  await ann
    .getByRole("dialog")
    .getByRole("button", { name: /End secret chat/ })
    .last()
    .click();
  await expect(ann.getByPlaceholder("Encrypted message")).toHaveCount(0, { timeout: 10_000 });

  // Server: chat, messages and the photo file are gone.
  const after = await ben.evaluate(
    async ([roomId, mid]) => ({
      messages: (await fetch(`/api/rooms/${roomId}/messages`)).status,
      media: (await fetch(`/api/rooms/${roomId}/messages/${mid}/media`)).status,
    }),
    [secretId, photoId] as const,
  );
  expect(after.messages).toBe(404);
  expect(after.media).toBe(404);

  // Devices: Ben's phone destroyed its key as soon as the chat disappeared (crypto-shredding).
  await expect.poll(() => keys(ben), { timeout: 15_000 }).toBe(0);
  await expect.poll(() => keys(ann), { timeout: 15_000 }).toBe(0);
  expect(dmId).toBeTruthy();
});
