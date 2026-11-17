// Captures d'écran réelles de Relay pour la présentation (assets/*.png).
// Prérequis : l'application tourne en local (npm run dev → http://localhost:5173, base D1 locale).
// Usage : node captures.cjs     (crée deux comptes de démonstration dans la base LOCALE uniquement)
const path = require("node:path");
const { createRequire } = require("node:module");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const { chromium } = createRequire(path.join(ROOT, "package.json"))("@playwright/test");
const OUT = path.join(__dirname, "assets");
const BASE = "http://localhost:5173";
const id = Math.random().toString(36).slice(2, 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execSync(`npx wrangler d1 execute relay-chat-db --local --command "${q}"`, { cwd: ROOT, stdio: "ignore" });

async function signUp(browser, username, opts) {
  const ctx = await browser.newContext({ baseURL: BASE, ...opts });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.fill("#username", username);
  await page.fill("#displayName", username.split("_")[0].replace(/^./, (c) => c.toUpperCase()));
  await page.fill("#password", "demo password 2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByPlaceholder("Search chats and people").waitFor();
  return page;
}
const post = (page, p, body = {}) =>
  page.evaluate(async ([p, b]) => (await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json(), [p, body]);

(async () => {
  sql("DELETE FROM rate_limits");
  const browser = await chromium.launch();
  const anas = await signUp(browser, `anas_${id}`, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, colorScheme: "light" });
  const riad = await signUp(browser, `riad_${id}`, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, colorScheme: "dark" });
  const { room } = await post(anas, "/api/rooms/dm", { username: `riad_${id}` });
  await post(riad, `/api/rooms/${room.id}/accept`);
  await anas.reload();
  await riad.reload();
  await anas.getByRole("button", { name: /Riad/ }).first().click();
  await riad.getByRole("button", { name: /Anas/ }).first().click();

  // 1) Conversation normale : ordinateur (clair) + mobile (sombre)
  const say = async (page, text, ph = /Message/) => {
    await page.getByPlaceholder(ph).fill(text);
    await page.getByRole("button", { name: "Send message" }).click();
    await sleep(1000);
  };
  await say(anas, "Salut Riad ! Le diagramme de PERT est prêt ?");
  await say(riad, "Oui, le chemin critique fait 6 jours 🎯");
  await say(anas, "Parfait, j'ajoute le Gantt à la présentation");
  await say(riad, "Super ! On répète demain à 10 h ?");
  await say(anas, "Ça marche 👍");
  await anas.getByRole("region", { name: /Chat with Riad/ }).getByText("Super ! On répète demain à 10 h ?").click({ button: "right" });
  await anas.getByRole("button", { name: "React ❤️" }).click();
  await anas.mouse.move(5, 5);
  await sleep(1500);
  await anas.screenshot({ path: path.join(OUT, "desktop.png") });
  await riad.screenshot({ path: path.join(OUT, "phone.png") });

  // 2) Chat secret (chiffré de bout en bout) sur mobile
  await anas.getByRole("button", { name: /View Riad's info/ }).click();
  await anas.getByRole("button", { name: "Secret chat" }).click();
  await anas.getByText(/waiting/i).first().waitFor({ timeout: 10000 });
  await riad.getByRole("button", { name: "Back" }).first().click().catch(() => {});
  await riad.getByRole("button", { name: /Riad|Anas/ }).filter({ hasText: /secret/i }).first().click()
    .catch(async () => { await riad.getByText(/secret chat/i).first().click(); });
  await riad.getByRole("button", { name: /^Accept/ }).click();
  await riad.getByPlaceholder("Encrypted message").waitFor({ timeout: 15000 });
  await anas.getByPlaceholder("Encrypted message").waitFor({ timeout: 15000 });
  await say(anas, "Ce message est chiffré de bout en bout 🔒", "Encrypted message");
  await say(riad, "Même le serveur ne peut pas le lire !", "Encrypted message");
  await sleep(1500);
  await riad.screenshot({ path: path.join(OUT, "secret-phone.png") });

  console.log("Captures écrites dans", OUT);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
