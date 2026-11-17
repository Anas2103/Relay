import { expect, test, type Page } from "@playwright/test";
import { closeBrowsers, openFriendChat, resetRateLimits, signUp, uniq } from "./helpers";

test.afterAll(closeBrowsers);
test.describe.configure({ mode: "serial" });

/*
 * Playing together in a chat: the server referees every move, so turns, hidden
 * picks and wins are enforced there, and both browsers see the same game live.
 */

let ann: Page;
let ben: Page;
let roomId: string;
const id = uniq();

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  ann = await signUp(browser, `ann_${id}`);
  ben = await signUp(browser, `ben_${id}`);
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

const lastBoard = (p: Page, label: string) => p.getByLabel(label).last();

test("tic-tac-toe: turns are enforced and the winner shows for both", async () => {
  await start(ann, "Tic-tac-toe");
  const a = lastBoard(ann, "Tic-tac-toe board");
  const b = lastBoard(ben, "Tic-tac-toe board");
  await expect(b).toBeVisible();
  await expect(ben.getByText("Make a move to play as ⭕").last()).toBeVisible();

  const sq = (board: typeof a, n: number) => board.getByRole("button", { name: new RegExp(`^Square ${n},`) });
  await sq(a, 1).click();
  await expect(sq(b, 1)).toHaveAccessibleName("Square 1, X");
  // Ann can't go twice in a row.
  await expect(sq(a, 2)).toBeDisabled();
  await expect(ann.getByText("Waiting for someone to play ⭕…").last()).toBeVisible();

  await sq(b, 4).click(); // Ben joins as ⭕
  await sq(a, 2).click();
  await sq(b, 5).click();
  await sq(a, 3).click(); // 1-2-3: Ann wins
  await expect(ann.getByText("You won! 🎉").last()).toBeVisible();
  await expect(ben.getByText("Ann won 🏆").last()).toBeVisible();
  // Rematch starts a fresh board.
  await ben
    .getByRole("button", { name: /Rematch/ })
    .last()
    .click();
  await expect(ann.getByLabel("Tic-tac-toe board")).toHaveCount(2);
});

test("rock paper scissors: picks stay secret until both chose", async () => {
  await start(ann, "Rock paper scissors");
  await ann.getByRole("button", { name: "rock" }).last().click();
  await expect(ann.getByText(/You picked ✓/).last()).toBeVisible();

  // Nothing in what the server sends Ben gives Ann's pick away.
  const raw = await ben.evaluate(async (roomId) => JSON.stringify(await (await fetch(`/api/rooms/${roomId}/messages`)).json()), roomId);
  expect(raw).not.toContain('"rock"');
  expect(raw).toContain('"hidden"');

  await ben.getByRole("button", { name: "scissors" }).last().click();
  await expect(ben.getByText(/Ann ✊ {2}vs {2}You ✌️ → Ann takes it/).last()).toBeVisible();
  await expect(ann.getByText(/You ✊ {2}vs {2}Ben ✌️ → You take it/).last()).toBeVisible();
});

test("connect four: discs drop to the bottom", async () => {
  await start(ben, "Connect Four");
  const board = lastBoard(ann, "Connect Four board");
  await expect(board).toBeVisible();
  await lastBoard(ben, "Connect Four board").getByRole("button", { name: "Column 4" }).first().click();
  // The bottom cell of column 4 (row 6) is filled: index 5*7+3.
  await expect(board.getByRole("button").nth(38)).toHaveClass(/bg-red-500/);
});

test("watch together: play and pause are shared", async () => {
  await start(ann, "Watch together");
  await ann.getByRole("textbox", { name: "YouTube link or search" }).fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  await ann.getByRole("button", { name: "Start" }).click();
  await expect(ben.getByText(/📺 Big Buck Bunny/).last()).toBeVisible({ timeout: 20_000 });

  await ann.getByRole("button", { name: "Play for everyone" }).last().click();
  await expect(ben.getByRole("button", { name: "Pause for everyone" }).last()).toBeVisible();
  await expect(ben.getByText(/Ann pressed play/).last()).toBeVisible();

  await ben.getByRole("button", { name: "Pause for everyone" }).last().click();
  await expect(ann.getByText(/Ben paused/).last()).toBeVisible();

  await ann.screenshot({ path: "test-results/together.png" });
});
