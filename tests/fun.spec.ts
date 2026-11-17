import { expect, test, type Page } from "@playwright/test";
import { closeBrowsers, PHONE, resetRateLimits, signUp, uniq } from "./helpers";

test.afterAll(closeBrowsers);
test.describe.configure({ mode: "serial" });

/*
 * Chill's radio, podcasts, games and fun corner — against the real free services
 * (Radio Browser, Apple podcasts, Open Trivia DB, JokeAPI) through Relay's server.
 */

let ann: Page;
let ben: Page;
const id = uniq();

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  ann = await signUp(browser, `ann_${id}`);
  ben = await signUp(browser, `ben_${id}`, PHONE);
  await ann.getByRole("button", { name: "Chill", exact: true }).click();
  await ben.getByRole("button", { name: "Chill", exact: true }).click();
});

const player = (p: Page) =>
  p.evaluate(async () => {
    // The exact module instance the page loaded (after a hot reload its URL carries a ?t= stamp).
    const url =
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .findLast((n) => n.includes("/src/lib/music.ts")) ?? "/src/lib/music.ts";
    const { music } = await import(/* @vite-ignore */ url);
    const s = music.get();
    const t = s.queue[s.index];
    return { playing: s.playing, time: s.time, kind: t?.kind ?? null, live: !!t?.live, rate: s.rate };
  });
const chillTab = (p: Page, name: string) => p.getByRole("tablist", { name: "Chill" }).getByRole("tab", { name }).click();

test("radio: Moroccan stations play live", async () => {
  await chillTab(ann, "Radio");
  const stations = ann.getByRole("list", { name: "Stations" }).getByRole("button", { name: /^Play / });
  await expect(stations.first()).toBeVisible({ timeout: 20_000 });
  // Some stations are off the air at any moment: try a few until one plays.
  let played = false;
  for (let i = 0; i < 5 && !played; i++) {
    await stations.nth(i).click();
    played = await expect
      .poll(async () => (await player(ann)).time, { timeout: 15_000 })
      .toBeGreaterThan(1)
      .then(
        () => true,
        () => false,
      );
  }
  expect(played).toBe(true);
  expect(await player(ann)).toMatchObject({ kind: "radio", live: true, playing: true });
  await expect(ann.getByRole("complementary", { name: "Now playing" }).getByText("LIVE")).toBeVisible();
  // No seek bar on live radio.
  await expect(ann.getByRole("complementary", { name: "Now playing" }).getByRole("slider", { name: "Seek" })).toHaveCount(0);

  // Favourite it, find it under Favorites.
  await ann
    .getByRole("button", { name: /^Add .* to favorites$/ })
    .first()
    .click();
  await ann.getByRole("tab", { name: /Favorites/ }).click();
  await expect(ann.getByRole("list", { name: "Stations" }).getByRole("button", { name: /^Play / })).toHaveCount(1);
  await ann.getByRole("complementary", { name: "Now playing" }).getByRole("button", { name: "Pause music" }).click();
});

test("podcasts: open a show, play an episode at 1.5×", async () => {
  await chillTab(ann, "Podcasts");
  await ann.getByRole("textbox", { name: "Search podcasts" }).fill("history");
  const shows = ann.getByRole("list", { name: "Podcasts" }).getByRole("button", { name: /^Open / });
  await expect(shows.first()).toBeVisible({ timeout: 20_000 });
  await shows.first().click();
  const episodes = ann.getByRole("list", { name: "Episodes" }).getByRole("button", { name: /^Play / });
  await expect(episodes.first()).toBeVisible({ timeout: 25_000 });
  await episodes.first().click();
  await expect.poll(async () => (await player(ann)).time, { timeout: 30_000 }).toBeGreaterThan(1);
  expect((await player(ann)).kind).toBe("podcast");
  await ann.getByRole("button", { name: "Speed 1×" }).click();
  await ann.getByRole("button", { name: "Speed 1.25×" }).click();
  expect((await player(ann)).rate).toBe(1.5);
  await ann.getByRole("button", { name: "Forward 30 seconds" }).click();
  await expect.poll(async () => (await player(ann)).time).toBeGreaterThan(25);
  await ann.getByRole("complementary", { name: "Now playing" }).getByRole("button", { name: "Pause music" }).click();
});

test("games: 2048 moves, minesweeper opens, trivia deals questions", async () => {
  await chillTab(ben, "Games");
  await ben.getByRole("button", { name: "Play 2048" }).click();
  const tiles = () => ben.getByLabel("2048 board").evaluate((el) => [...el.children].filter((c) => /\d/.test(c.textContent ?? "")).length);
  expect(await tiles()).toBe(2);
  for (const k of ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"]) await ben.keyboard.press(k);
  expect(await tiles()).toBeGreaterThan(2);
  await ben.getByRole("button", { name: "Back to games" }).click();

  await ben.getByRole("button", { name: "Play Minesweeper" }).click();
  await ben.getByLabel("Minefield").getByRole("button").nth(40).click();
  // The first tap is never a mine and opens an area.
  await expect(
    ben
      .getByLabel("Minefield")
      .getByRole("button", { name: /mines around/ })
      .first(),
  ).toBeVisible();
  await ben.getByRole("button", { name: "Back to games" }).click();

  for (const g of ["Snake", "Memory", "Reaction time", "Typing speed"]) {
    await ben.getByRole("button", { name: `Play ${g}` }).click();
    await expect(ben.getByRole("heading", { name: g })).toBeVisible();
    await ben.getByRole("button", { name: "Back to games" }).click();
  }

  await ben.getByRole("button", { name: "Play Trivia" }).click();
  await ben.getByRole("button", { name: /Anything/ }).click();
  await expect(ben.getByText(/^1 \/ 10/)).toBeVisible({ timeout: 20_000 });
  await ben.locator("button.rounded-2xl.px-4").first().click();
  await expect(ben.getByText(/^2 \/ 10/)).toBeVisible({ timeout: 5_000 });
});

test("fun corner: a joke and a fact load", async () => {
  await chillTab(ann, "Fun");
  await expect(ann.getByRole("button", { name: "Another one" })).toBeEnabled({ timeout: 15_000 });
  await expect(ann.getByRole("button", { name: "Another fact" })).toBeEnabled({ timeout: 15_000 });
  await ann.getByRole("button", { name: "Flip a coin" }).click();
  await expect(ann.getByText(/Heads|Tails/)).toBeVisible();
  await ann.screenshot({ path: "test-results/fun.png" });
});
