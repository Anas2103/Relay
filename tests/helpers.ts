import { execSync } from "node:child_process";
import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";

/** Browsers opened by signUp; each test file closes them with `test.afterAll(closeBrowsers)`. */
const opened = new Set<BrowserContext>();
export async function closeBrowsers() {
  for (const ctx of opened) await ctx.close().catch(() => {});
  opened.clear();
}

/** Sign-ups are rate limited per IP; tests create many accounts, so start each file clean. */
export function resetRateLimits() {
  execSync(`npx wrangler d1 execute relay-chat-db --local --command "DELETE FROM rate_limits"`, { stdio: "ignore" });
}

export const uniq = () => Math.random().toString(36).slice(2, 7);

export const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: false,
  colorScheme: "dark",
};

/** Creates an account in a fresh browser and lands in the chat list. */
export async function signUp(browser: Browser, name: string, opts: BrowserContextOptions = {}): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ["microphone", "camera"], viewport: { width: 1280, height: 800 }, ...opts });
  opened.add(ctx);
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.fill("#username", name);
  await page.fill("#displayName", name.split("_")[0].replace(/^./, (c) => c.toUpperCase()));
  await page.fill("#password", "test password 1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByPlaceholder("Search chats and people").waitFor();
  return page;
}

export function post<T = unknown>(page: Page, path: string, body: unknown = {}): Promise<T> {
  return page.evaluate(
    async ([path, body]) => (await fetch(path as string, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json(),
    [path, body] as const,
  ) as Promise<T>;
}

/** A starts a chat with B and B accepts it; both end up with it open. */
export async function openFriendChat(a: Page, b: Page, bUsername: string, aDisplay: string, bDisplay: string) {
  const { room } = await post<{ room: { id: string } }>(a, "/api/rooms/dm", { username: bUsername });
  await post(b, `/api/rooms/${room.id}/accept`);
  await a.reload();
  await b.reload();
  await a.getByRole("button", { name: new RegExp(bDisplay) }).first().click();
  await b.getByRole("button", { name: new RegExp(aDisplay) }).first().waitFor();
  await b.getByRole("button", { name: new RegExp(aDisplay) }).first().click();
  return room.id;
}

/**
 * Runs `fn` against the app's own call engine (the exact module instance the
 * page loaded), e.g. `call(page, (c) => c.getState().micOn)`.
 */
export function call<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(async (fn) => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/src/lib/calls.ts")) ?? "/src/lib/calls.ts";
    const { calls } = await import(/* @vite-ignore */ url);
    const stats = await calls.pc?.getStats();
    let audioIn = 0;
    let frames = 0;
    stats?.forEach((r: { type: string; kind: string; bytesReceived: number; framesDecoded?: number }) => {
      if (r.type === "inbound-rtp" && r.kind === "audio") audioIn += r.bytesReceived;
      if (r.type === "inbound-rtp" && r.kind === "video") frames += r.framesDecoded ?? 0;
    });
    const result = await (0, eval)(fn)(calls, { audioIn, frames });
    return JSON.parse(JSON.stringify(result ?? null, (_k, v) => (v instanceof MediaStream ? v.getTracks().map((t) => t.kind).join(",") : v)));
  }, fn) as Promise<T>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
