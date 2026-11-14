import { expect, test, type Page } from "@playwright/test";
import { call, openFriendChat, PHONE, resetRateLimits, signUp, sleep, uniq } from "./helpers";

/*
 * Real WebRTC calls between a desktop browser (Ann) and a phone-sized one (Ben),
 * with Chromium's fake microphones, cameras and speakers.
 */
test.describe.configure({ mode: "serial" });

let ann: Page;
let ben: Page;
const id = uniq();

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  ann = await signUp(browser, `ann_${id}`);
  ben = await signUp(browser, `ben_${id}`, PHONE);
});

test.afterAll(async () => {
  await ann?.context().close();
  await ben?.context().close();
});

const inCall = (p: Page) => p.getByRole("dialog", { name: /call with/ }).getByText(/^0:0\d$/).first();

async function startCall(video = false) {
  await ann.getByRole("button", { name: video ? "Video call" : "Voice call", exact: true }).click();
  await ben.getByText(`Incoming ${video ? "video" : "voice"} call…`).waitFor();
  await ben.getByRole("button", { name: "Accept" }).click();
  await inCall(ann).waitFor({ timeout: 20_000 });
  await sleep(800);
}

async function hangUp() {
  expect(await call(ann, "(c) => c.getState().phase")).toBe("active"); // the call is still on
  await ann.getByRole("button", { name: "End call" }).click();
  await sleep(1500);
  // The "call ended" screen closes by itself after a moment; close it sooner if it's still there.
  await ann.getByRole("button", { name: "Close" }).click({ timeout: 1000 }).catch(() => {});
  await ben.getByRole("button", { name: "Close" }).click({ timeout: 1000 }).catch(() => {});
}

test("Settings lists devices, saves the mic and previews the camera", async () => {
  await ann.getByRole("button", { name: "Settings" }).first().click();
  await ann.getByRole("button", { name: /Voice & video/ }).first().click();
  const mic = ann.locator("label", { hasText: "Microphone" }).locator("select").first();
  await expect(mic.locator("option")).toHaveCount(3); // default + 2 fake mics
  const second = (await mic.locator("option").nth(2).getAttribute("value"))!;
  await mic.selectOption(second);
  expect(await ann.evaluate(() => JSON.parse(localStorage.getItem("relay:devices")!).mic)).toBe(second);

  await ann.getByRole("button", { name: "Preview" }).click();
  await expect.poll(() => ann.evaluate(() => [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0))).toBe(true);
  await ann.getByRole("button", { name: "Stop" }).first().click();

  await ann.getByRole("radio", { name: "Digital" }).click();
  expect(await ann.evaluate(() => JSON.parse(localStorage.getItem("relay:devices")!).ringtone)).toBe("digital");
  await ann.keyboard.press("Escape");
  await openFriendChat(ann, ben, `ben_${id}`, "Ann", "Ben");
});

test("a voice call uses the chosen mic and can turn into a video call", async () => {
  await startCall();
  const saved = await ann.evaluate(() => JSON.parse(localStorage.getItem("relay:devices")!).mic);
  expect(await call(ann, "(c) => c.getState().micId")).toBe(saved);

  await ann.getByRole("button", { name: /Turn camera on/ }).click();
  await expect.poll(() => call<number>(ben, "(c, s) => s.frames"), { timeout: 15_000 }).toBeGreaterThan(10);
  expect(await call(ben, "(c) => c.getState().peerCamOn")).toBe(true);

  await ann.getByRole("button", { name: /Turn camera off/ }).click();
  await expect.poll(() => call<string>(ann, "(c) => c.getState().localStream")).toBe("audio");
  await expect.poll(() => call(ben, "(c) => c.getState().peerCamOn")).toBe(false);
});

test("switching mic and volume mid-call keeps the audio flowing", async () => {
  await ann.getByRole("button", { name: /Call settings/ }).click();
  const panel = ann.getByRole("dialog", { name: "Call settings" });
  const select = panel.locator("label", { hasText: "Microphone" }).locator("select");
  const current = await call<string>(ann, "(c) => c.getState().micId");
  const other = (await select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).find((v) => v && v !== current)!;
  const before = await call<number>(ben, "(c, s) => s.audioIn");
  await select.selectOption(other);
  await expect.poll(() => call(ann, "(c) => c.getState().micId")).toBe(other);
  await expect.poll(() => call<number>(ben, "(c, s) => s.audioIn")).toBeGreaterThan(before + 2000);

  await panel.locator('input[type="range"]').nth(1).fill("40");
  expect(await ann.evaluate(() => document.querySelector("audio")!.volume)).toBeCloseTo(0.4);
  await panel.getByRole("button", { name: "Close" }).click();
});

test("mute, the muted hint, signal bars and reactions", async () => {
  await expect(ann.getByRole("button", { name: /connection/ })).toBeVisible({ timeout: 10_000 });
  await ann.keyboard.press("m");
  await expect.poll(() => call(ben, "(c) => c.getState().peerMicOn")).toBe(false);
  await ann.getByText("You're muted — tap to unmute").click({ timeout: 10_000 });
  expect(await call(ann, "(c) => c.getState().micOn")).toBe(true);

  await ann.getByRole("button", { name: "Send a reaction" }).click();
  await ann.getByRole("button", { name: "Send 🎉" }).click();
  await expect(ben.getByRole("img", { name: "Ann sent 🎉" })).toBeVisible();
  await ann.getByRole("button", { name: "Send a reaction" }).click();
});

test("screen sharing and video quality", async () => {
  await ann.getByRole("button", { name: "Share your screen" }).click();
  await expect.poll(() => call(ben, "(c) => c.getState().peerScreen")).toBe(true);
  await ann.getByRole("button", { name: "Stop sharing your screen" }).click();
  await expect.poll(() => call(ben, "(c) => c.getState().peerScreen")).toBe(false);

  await ann.getByRole("button", { name: /Turn camera on/ }).click();
  await ann.getByRole("button", { name: /Call settings/ }).click();
  await ann.getByRole("radio", { name: "Data saver" }).click();
  await expect.poll(() => call(ann, "(c) => c.videoSender.getParameters().encodings[0].maxBitrate")).toBe(250_000);
  await ann.getByRole("radio", { name: "Auto" }).click();
});

test("push-to-talk", async () => {
  await ann.getByRole("switch", { name: /Push-to-talk/ }).click();
  await expect.poll(() => call(ann, "(c) => c.getState().micOn")).toBe(false);
  await ann.getByRole("button", { name: "Close" }).first().click();
  await ann.locator("body").click({ position: { x: 640, y: 300 } });
  await ann.keyboard.down("Space");
  await expect.poll(() => call(ben, "(c) => c.getState().peerMicOn")).toBe(true);
  await ann.keyboard.up("Space");
  await expect.poll(() => call(ann, "(c) => c.getState().micOn")).toBe(false);
  // Turn it back off the way the app does (the switch lives in the closed panel).
  await ann.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/src/lib/devices.ts"))!;
    (await import(/* @vite-ignore */ url)).devicePrefs.set({ pushToTalk: false });
  });
  await expect.poll(() => call(ann, "(c) => c.getState().micOn")).toBe(true);
});

test("an unplugged mic falls back to the default and the call goes on", async () => {
  const before = await call<number>(ben, "(c, s) => s.audioIn");
  await call(ann, "(c) => { const t = c.rawMic.getAudioTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')); }");
  await expect.poll(() => call<string>(ann, "(c) => c.getState().notice?.text ?? ''")).toMatch(/Microphone disconnected/);
  await expect.poll(() => call<number>(ben, "(c, s) => s.audioIn")).toBeGreaterThan(before + 2000);
  await hangUp();
});

test("decline with a message, then Call again", async () => {
  await ann.getByRole("button", { name: "Voice call", exact: true }).click();
  await ben.getByText("Incoming voice call…").waitFor();
  await ben.getByRole("button", { name: "Reply with a message" }).click();
  await ben.getByRole("button", { name: "I'll call you back in a few minutes." }).click();
  await expect(ann.getByText("Call declined")).toBeVisible();
  await expect(ann.getByText("I'll call you back in a few minutes.").first()).toBeVisible();
  await ann.getByRole("button", { name: "Call again" }).click();
  await ben.getByText("Incoming voice call…").waitFor();
  await ben.getByRole("button", { name: "Decline", exact: true }).click();
  await sleep(500);
});

test("answer a video call without video, then turn the camera on", async () => {
  await ann.getByRole("button", { name: "Close" }).click({ timeout: 1000 }).catch(() => {});
  await ann.getByRole("button", { name: "Video call", exact: true }).click();
  await ben.getByText("Incoming video call…").waitFor();
  await ben.getByRole("button", { name: "Answer without video" }).click();
  await inCall(ann).waitFor({ timeout: 20_000 });
  await expect.poll(() => call(ann, "(c) => c.getState().peerCamOn")).toBe(false);
  expect(await call(ben, "(c) => c.getState().localStream")).toBe("audio");
  await ben.getByRole("button", { name: /Turn camera on/ }).click();
  await expect.poll(() => call<number>(ann, "(c, s) => s.frames"), { timeout: 15_000 }).toBeGreaterThan(10);
  await hangUp();
});
