import { expect, test, type Page } from "@playwright/test";
import { openFriendChat, PHONE, resetRateLimits, signUp, uniq } from "./helpers";

test.describe.configure({ mode: "serial" });

let ann: Page;
let ben: Page;
let roomId: string;
const id = uniq();

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  ann = await signUp(browser, `ann_${id}`, { permissions: ["geolocation"], geolocation: { latitude: 33.57311, longitude: -7.58984 } });
  ben = await signUp(browser, `ben_${id}`, PHONE);
  roomId = await openFriendChat(ann, ben, `ben_${id}`, "Ann", "Ben");
});

const annChat = () => ann.getByRole("region", { name: "Chat with Ben" });
const benChat = () => ben.getByRole("region", { name: "Chat with Ann" });

async function say(text: string) {
  await ann.getByPlaceholder(/Message/).fill(text);
  await ann.keyboard.press("Enter");
  await expect(annChat().getByText(text).first()).toBeVisible();
}

test("share your location after confirming it", async () => {
  await ann.getByRole("button", { name: "Attach" }).click();
  await ann.getByRole("menuitem", { name: "Location" }).or(ann.getByRole("button", { name: "Location" })).first().click();
  await expect(ann.getByText("Share your location?")).toBeVisible();
  await expect(ann.getByText("33.57311° N, 7.58984° W").first()).toBeVisible();
  await ann.getByRole("button", { name: "Send location" }).click();
  const card = benChat().getByRole("link", { name: /Location 33\.57311° N, 7\.58984° W/ });
  await expect(card).toBeVisible();
  expect(await card.getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=33.57311,-7.58984");
});

test("the server refuses a made-up location", async () => {
  const error = await ann.evaluate(
    (roomId) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/api/rooms/${roomId}/ws`);
        ws.onopen = () => ws.send(JSON.stringify({ type: "send", clientId: "x1", kind: "text", body: "📍", meta: { location: { lat: 123, lng: 0 } } }));
        ws.onmessage = (e) => {
          const ev = JSON.parse(e.data);
          if (ev.type === "error" && ev.clientId === "x1") resolve(ev.message);
        };
        setTimeout(() => resolve("no error"), 5000);
      }),
    roomId,
  );
  expect(error).toBe("Invalid location.");
});

test("search filters: type, person and no words needed", async () => {
  await say("see https://example.com/recipe for dinner");
  await say("plain words only");
  await ben.getByPlaceholder(/Message/).fill("from ben with https://example.org");
  await ben.getByRole("button", { name: "Send message" }).click();
  await expect(annChat().getByText("from ben with").first()).toBeVisible();

  await ann.getByRole("button", { name: "Search messages" }).click();
  const panel = ann.getByRole("dialog", { name: "Search messages" });
  await panel.getByLabel("Type").selectOption("links");
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await panel.getByLabel("From").selectOption({ label: "Me" });
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  await expect(panel.getByText("recipe")).toBeVisible();
  await panel.getByRole("button", { name: "Close search" }).click();
});

test("Remind me schedules a reminder in Saved Messages", async () => {
  await annChat().getByText("plain words only").click({ button: "right" });
  await ann.getByRole("menuitem", { name: "Remind me" }).click();
  await ann.getByRole("button", { name: /Tomorrow morning/ }).click();
  await expect(ann.getByText(/Reminder set for/)).toBeVisible();

  // And a reminder that's due shows up in Saved Messages, marked as a reminder.
  const delivered = await ann.evaluate(async () => {
    const { room } = await (await fetch("/api/rooms/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
    const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/src/lib/sendToRoom.ts"))!;
    const { scheduleInRoom } = await import(/* @vite-ignore */ url);
    await scheduleInRoom(room.id, "⏰ Reminder · test\n\nwater the plants", Date.now() + 6000);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const { messages } = await (await fetch(`/api/rooms/${room.id}/messages`)).json();
      if (messages.some((m: { body: string }) => m.body.includes("water the plants"))) return true;
    }
    return false;
  });
  expect(delivered).toBe(true);
});
