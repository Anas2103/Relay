import { expect, test, type Page } from "@playwright/test";
import { closeBrowsers, PHONE, resetRateLimits, signUp, uniq } from "./helpers";

test.afterAll(closeBrowsers);
test.describe.configure({ mode: "serial" });

/*
 * Chill: music (real Audius songs through Relay's server) and the Shorts feed
 * (YouTube's answer is stubbed: there's no API key in local dev).
 */

let ann: Page;
let ben: Page;
const id = uniq();

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  ann = await signUp(browser, `ann_${id}`);
  ben = await signUp(browser, `ben_${id}`, PHONE);
});

const musicState = (p: Page) =>
  p.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/src/lib/music.ts")) ?? "/src/lib/music.ts";
    const { music } = await import(/* @vite-ignore */ url);
    const s = music.get();
    return { playing: s.playing, time: s.time, queue: s.queue.length, title: s.queue[s.index]?.title ?? null, video: s.video, preview: s.preview };
  });

test("music: type an artist, pick the exact song, it plays and keeps playing while chatting", async () => {
  await ann.getByRole("button", { name: "Chill", exact: true }).click();
  await ann.getByRole("tablist", { name: "Chill" }).getByRole("tab", { name: "Music" }).click();
  // Nothing random: it waits for you to type.
  await expect(ann.getByText("Type a song name or an artist above, then choose the song.")).toBeVisible();

  await ann.getByRole("textbox", { name: "Search music" }).fill("the weeknd blinding lights");
  const pick = ann.getByRole("list", { name: "Songs" }).getByRole("button", { name: /^Play Blinding Lights by The Weeknd$/ });
  await expect(pick.first()).toBeVisible({ timeout: 20_000 });
  await pick.first().click();

  const { youtube } = await ann.evaluate(async () => (await fetch("/api/chill/status")).json());
  if (youtube) {
    // The full song: its official YouTube version, in the floating player.
    await expect.poll(async () => (await musicState(ann)).video, { timeout: 20_000 }).not.toBeNull();
    await expect(ann.getByLabel("Now playing video")).toBeVisible();
    console.log("matched video:", (await musicState(ann)).video);
  } else {
    // No YouTube key: Apple's 30-second preview plays instead.
    await expect.poll(async () => (await musicState(ann)).time, { timeout: 30_000 }).toBeGreaterThan(1);
    expect((await musicState(ann)).preview).toBe(true);
  }
  expect((await musicState(ann)).title).toBe("Blinding Lights");
  await expect(ann.getByRole("complementary", { name: "Now playing" })).toBeVisible();
  await ann.screenshot({ path: "test-results/chill-music.png" });

  // Cover art and previews come through Relay (the page only loads from itself).
  const media = await ann.evaluate(async () => {
    // The exact module instance the page loaded (after a hot reload its URL carries a ?t= stamp).
    const url = performance.getEntriesByType("resource").map((e) => e.name).findLast((n) => n.includes("/src/lib/music.ts")) ?? "/src/lib/music.ts";
    const { music } = await import(/* @vite-ignore */ url);
    const id = music.get().queue[music.get().index].id.replace("it-", "");
    const art = await fetch(`/api/chill/songs/${id}/art`);
    const prev = await fetch(`/api/chill/songs/${id}/preview`, { headers: { Range: "bytes=0-999" } });
    return { art: art.status, artType: art.headers.get("content-type"), prev: prev.status, prevType: prev.headers.get("content-type") };
  });
  expect(media).toMatchObject({ art: 200, artType: expect.stringMatching(/^image\//), prev: expect.any(Number), prevType: expect.stringMatching(/^audio\//) });

  // Back to the chats: it keeps going (the floating video, or the mini player for a preview).
  await ann.getByRole("button", { name: "Back to chats" }).click();
  const player = youtube ? ann.getByLabel("Now playing video") : ann.getByLabel("Music player");
  await expect(player).toBeVisible();
  await player.getByRole("button", { name: "Stop music" }).click();
  await expect(player).toBeHidden();

  if (process.env.MATCH_CHECK && youtube) {
    // Which video each well-known song gets (prints titles; uses YouTube quota).
    const out = await ann.evaluate(async () => {
      const songs = ["Shape of You Ed Sheeran", "Bohemian Rhapsody Queen", "Despacito Luis Fonsi", "Calm Down Rema", "Lose Yourself Eminem", "Saiidi Saad Lamjarred"];
      const lines: string[] = [];
      for (const q of songs) {
        const { tracks } = await (await fetch(`/api/chill/songs?q=${encodeURIComponent(q)}`)).json();
        const t = tracks[0];
        if (!t) { lines.push(`${q} → (no songs found)`); continue; }
        const r = await fetch(`/api/chill/songs/${t.id.replace("it-", "")}/video`);
        const v = r.ok ? (await r.json()).videoId : `(${r.status})`;
        lines.push(`${t.title} — ${t.artist} → ${v}`);
      }
      return lines;
    });
    console.log(out.join("\n"));
  }
});

test("shorts: without a key it explains; with one it's a swipeable feed", async () => {
  await ben.getByRole("button", { name: "Chill", exact: true }).click();
  await expect(ben.getByText("Shorts aren't switched on yet")).toBeVisible();
  await ben.getByRole("button", { name: "Back to chats" }).click();

  // Stand in for YouTube.
  await ben.route("**/api/chill/status", (r) => r.fulfill({ json: { youtube: true } }));
  await ben.route("**/api/chill/shorts*", (r) =>
    r.fulfill({
      json: {
        videos: ["aqz-KE-bpKQ", "jNQXAC9IVRw", "dQw4w9WgXcQ"].map((v, i) => ({ id: v, title: `Short ${i + 1}`, channel: "Test", thumb: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" })),
        next: null,
      },
    }),
  );
  await ben.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<html><body>player</body></html>" }));
  await ben.getByRole("button", { name: "Chill", exact: true }).click();

  const feed = ben.getByTestId("shorts-feed");
  await expect(feed.getByText("Short 1")).toBeVisible();
  // Only the Short on screen gets a player.
  await expect(feed.locator("iframe")).toHaveCount(1);
  await expect(feed.locator("iframe")).toHaveAttribute("src", /aqz-KE-bpKQ/);
  await expect(feed.locator("iframe")).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");

  await ben.screenshot({ path: "test-results/chill-shorts.png" });
  // Swipe to the next one.
  await feed.evaluate((el) => el.scrollBy({ top: el.clientHeight }));
  await expect(feed.locator("iframe")).toHaveAttribute("src", /jNQXAC9IVRw/);

  // Sound button and topic chips.
  await ben.getByRole("button", { name: /Sound (on|off)/ }).nth(1).click();
  await ben.getByRole("tab", { name: "Funny" }).click();
  await expect(ben.getByRole("tab", { name: "Funny" })).toHaveAttribute("aria-selected", "true");
  // Music on a phone.
  await ben.getByRole("tablist", { name: "Chill" }).getByRole("tab", { name: "Music" }).click();
  await ben.getByRole("textbox", { name: "Search music" }).fill("ed sheeran");
  await ben.getByRole("list", { name: "Songs" }).getByRole("button", { name: /^Play / }).first().click();
  await expect(ben.getByRole("complementary", { name: "Now playing" })).toBeVisible();
  await ben.screenshot({ path: "test-results/chill-music-phone.png" });
  await ben.getByRole("complementary", { name: "Now playing" }).getByRole("button", { name: /Pause music|Play music/ }).first().click();
});
