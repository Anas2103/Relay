import { expect, test, type Page } from "@playwright/test";
import { closeBrowsers, openFriendChat, PHONE, resetRateLimits, signUp, uniq } from "./helpers";

test.afterAll(closeBrowsers);
test.describe.configure({ mode: "serial" });

/*
 * Chat themes (shared per chat, like Instagram), the new team and board games,
 * and the desktop rail / phone tab bar.
 */

let ann: Page;
let ben: Page;
let roomId: string;
const id = uniq();

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  ann = await signUp(browser, `ann_${id}`);
  ben = await signUp(browser, `ben_${id}`, { colorScheme: "dark" });
  roomId = await openFriendChat(ann, ben, `ben_${id}`, "Ann", "Ben");
});

async function start(p: Page, game: string) {
  await p.getByRole("button", { name: "Attach" }).click();
  await p.getByRole("menuitem", { name: "Game / Watch" }).click();
  await p
    .getByRole("dialog", { name: "Play together" })
    .getByRole("button", { name: new RegExp(game) })
    .click();
}

/** The game messages as the server sends them to this browser. */
const rawMessages = (p: Page) => p.evaluate(async (roomId) => JSON.stringify(await (await fetch(`/api/rooms/${roomId}/messages`)).json()), roomId);

test("a chat theme is shared: both people see it live, and it survives a reload", async () => {
  await ann.getByRole("button", { name: /info and shared media/ }).click();
  await ann.getByRole("button", { name: /^Theme/ }).click();
  await ann.getByRole("radio", { name: "Ocean" }).click();

  await expect(ben.locator("[data-chat-theme=ocean]")).toBeVisible();
  await expect(ben.getByText("Ann changed the theme to Ocean")).toBeVisible();
  await ben.reload();
  await ben.getByRole("button", { name: /Ann/ }).first().click();
  await expect(ben.locator("[data-chat-theme=ocean]")).toBeVisible();

  // The server only accepts themes it knows.
  const res = await ann.evaluate(
    async (roomId) =>
      (await fetch(`/api/rooms/${roomId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "nope" }) }))
        .status,
    roomId,
  );
  expect(res).toBe(400);

  // Anyone can turn it off again, and each person can choose not to see themes at all.
  await ann.keyboard.press("Escape");
  const off = await ben.evaluate(
    async (roomId) =>
      (await fetch(`/api/rooms/${roomId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: null }) })).status,
    roomId,
  );
  expect(off).toBe(200);
  await expect(ann.locator("[data-chat-theme]")).toHaveCount(0);
  await expect(ann.getByText("Ben changed the theme to the default")).toBeVisible();
});

test("Word Team: the word stays secret, anyone can guess, repeated words are refused", async () => {
  await start(ann, "Word Team");
  await expect(ben.getByText("Guess the word together").last()).toBeVisible();
  const raw = await rawMessages(ben);
  expect(raw).toContain('"type":"wordteam"');
  expect(raw).toMatch(/"word":""/);

  await ann.getByLabel("Your guess").last().fill("crane");
  await ann.getByLabel("Your guess").last().press("Enter");
  await expect(ben.getByText("5 left").last()).toBeVisible();
  // Same word twice is refused by the server.
  await ben.getByLabel("Your guess").last().fill("crane");
  await ben.getByLabel("Your guess").last().press("Enter");
  await expect(ben.getByText("That word was already tried.")).toBeVisible();
});

test("Crack the Code: colors are scored and the code is hidden until the end", async () => {
  await start(ben, "Crack the Code");
  await expect(ann.getByText("Find the 4 hidden colors").last()).toBeVisible();
  expect(await rawMessages(ann)).toMatch(/"type":"code","players":\["[^"]+"\],"winner":null,"code":\[\]/);
  for (const c of ["red", "blue", "green", "yellow"])
    await ann
      .getByRole("button", { name: `Add ${c}` })
      .last()
      .click();
  await ann.getByRole("button", { name: "Try this code" }).last().click();
  await expect(ben.getByText("9 tries left").last()).toBeVisible();
  await expect(ben.getByLabel(/right place, \d wrong place/).last()).toBeVisible();
});

test("Pair Up: only face-up cards reach the app, and a full board is a team win", async () => {
  await start(ann, "Pair Up");
  await expect(ben.getByText("Find all 8 pairs").last()).toBeVisible();
  const deckOf = async (p: Page) => {
    const data = JSON.parse(await rawMessages(p)) as { messages: { meta?: { game?: { type: string; deck: number[] } } }[] };
    return data.messages
      .map((m) => m.meta?.game)
      .filter((g) => g?.type === "pairs")
      .at(-1)!.deck;
  };
  expect((await deckOf(ben)).every((f) => f === -1)).toBe(true);

  // Reveal every card two at a time (at most 8 misses, under the limit), then match the pairs.
  const cards = (p: Page) => p.getByLabel("Cards").last().getByRole("button");
  const faces = new Map<number, number>();
  const flip = async (p: Page, i: number) => {
    await cards(p).nth(i).click();
    await expect.poll(async () => (await deckOf(p))[i]).not.toBe(-1);
    faces.set(i, (await deckOf(p))[i]);
  };
  for (let i = 0; i < 16; i += 2) {
    await flip(ann, i);
    await flip(ben, i + 1);
  }
  for (let face = 0; face < 8; face++) {
    const [x, y] = [...faces].filter(([, f]) => f === face).map(([i]) => i);
    if (await cards(ann).nth(x).isDisabled()) continue; // matched by luck while revealing
    await flip(face % 2 ? ben : ann, x);
    await flip(face % 2 ? ben : ann, y);
  }
  await expect(ann.getByText(/Solved together/).last()).toBeVisible();
  await expect(ben.getByText(/Team: Ann, You|Team: You, Ben/).last()).toBeVisible();
});

test("Reversi and Mancala: legal moves only, turns alternate", async () => {
  await start(ann, "Reversi");
  const board = (p: Page) => p.getByLabel("Reversi board").last();
  await expect(board(ben)).toBeVisible();
  // Square 20 (index 19) is a legal opening for dark.
  await board(ann).getByRole("button", { name: "Square 20, you can play here" }).click();
  await expect(board(ben).getByRole("button", { name: "Square 28, dark" })).toBeVisible();
  await expect(ben.getByText("⚫ Ann 4 – 1 ? ⚪").last()).toBeVisible();

  await start(ben, "Mancala");
  await expect(ann.getByText("Make a move to join").last()).toBeVisible();
  // Ben's 3rd pit holds 4 seeds and ends in his store: he goes again.
  await ben.getByRole("button", { name: "Your pit with 4 seeds" }).nth(2).click();
  await expect(ben.getByText("Your move").last()).toBeVisible();
  await expect(ben.getByLabel("Your store: 1").last()).toBeVisible();
});

test("desktop rail and phone tab bar", async ({ browser }) => {
  // Desktop: the rail opens games and settings.
  await ann.getByRole("navigation", { name: "Spaces" }).getByRole("button", { name: "Games" }).click();
  await expect(ann.getByRole("tablist", { name: "Chill" }).getByRole("tab", { name: "Games" })).toHaveAttribute("aria-selected", "true");
  await ann.getByRole("navigation", { name: "Spaces" }).getByRole("button", { name: "All chats" }).click();

  // Phone: no rail; a bottom tab bar instead.
  const phone = await signUp(browser, `cat_${id}`, PHONE);
  await expect(phone.getByRole("navigation", { name: "Spaces" })).toBeHidden();
  const tabs = phone.getByRole("navigation", { name: "Sections" });
  await expect(tabs).toBeVisible();
  await tabs.getByRole("button", { name: "Settings" }).click();
  await expect(phone.getByRole("dialog").first()).toBeVisible();
});
