import { test, type Page } from "@playwright/test";
import { closeBrowsers, openFriendChat, PHONE, resetRateLimits, signUp, uniq } from "./helpers";

// Temporary: screenshots of every game for a UI review. Not part of the suite.
test.afterAll(closeBrowsers);
test.describe.configure({ mode: "serial" });

let desk: Page;
let phone: Page;
const id = uniq();
const shot = (p: Page, name: string) => p.screenshot({ path: `test-results/audit/${name}.png` });

test.beforeAll(async ({ browser }) => {
  resetRateLimits();
  desk = await signUp(browser, `ann_${id}`);
  phone = await signUp(browser, `ben_${id}`, { ...PHONE, colorScheme: "dark" });
});

const GAMES = ["Trivia", "2048", "Snake", "Minesweeper", "Memory", "Reaction time", "Typing speed"];

test("solo games", async () => {
  for (const [p, tag] of [
    [desk, "desk"],
    [phone, "phone"],
  ] as const) {
    await p.getByRole("button", { name: "Chill", exact: true }).click();
    await p.getByRole("tablist", { name: "Chill" }).getByRole("tab", { name: "Games" }).click();
    await shot(p, `${tag}-hub`);
    for (const g of GAMES) {
      await p.getByRole("button", { name: `Play ${g}` }).click();
      await p.waitForTimeout(600);
      if (g === "2048") for (const k of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) await p.keyboard.press(k);
      if (g === "Minesweeper") await p.getByLabel("Minefield").getByRole("button").nth(40).click();
      if (g === "Memory") await p.getByRole("button", { name: "Hidden card" }).first().click();
      if (g === "Snake")
        await p
          .getByRole("button", { name: "Start" })
          .click()
          .catch(() => {});
      if (g === "Trivia") {
        await shot(p, `${tag}-trivia-menu`);
        await p.getByRole("button", { name: /Anything/ }).click();
        await p.waitForTimeout(2500);
      }
      await p.waitForTimeout(400);
      await shot(p, `${tag}-${g.replace(/\s/g, "-").toLowerCase()}`);
      await p
        .getByRole("button", { name: "Back to games" })
        .click()
        .catch(async () => {
          await p.getByRole("button", { name: "Back to games" }).first().click();
        });
      if (g === "Trivia")
        await p
          .getByRole("button", { name: "Back to games" })
          .click()
          .catch(() => {});
    }
    await p.getByRole("button", { name: "Back to chats" }).click();
  }
});

test("chat games", async () => {
  await openFriendChat(desk, phone, `ben_${id}`, "Ann", "Ben");
  for (const g of ["Tic-tac-toe", "Connect Four", "Rock paper scissors"]) {
    await desk.getByRole("button", { name: "Attach" }).click();
    await desk.getByRole("menuitem", { name: "Game / Watch" }).click();
    if (g === "Tic-tac-toe") await shot(desk, "desk-game-dialog");
    await desk
      .getByRole("dialog", { name: "Play together" })
      .getByRole("button", { name: new RegExp(g) })
      .click();
    await desk.waitForTimeout(800);
  }
  await desk
    .getByRole("button", { name: /^Square 5,/ })
    .last()
    .click();
  await desk.waitForTimeout(800);
  await shot(desk, "desk-chat-games");
  await shot(phone, "phone-chat-games");
});
