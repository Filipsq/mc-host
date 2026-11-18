// Screenshots the support bot sends when a customer asks where something is
// (src/lib/supportScreens.json, served from public/pomoc/<key>.png). Each shows
// one panel page of a test account's server with the thing to click outlined.
//
// Run it when a panel page changes, against the live site with a test account
// (never a customer's or an admin's), or a local copy with made-up data:
//
//   SHOTS_URL=https://mchosting.pl SHOTS_EMAIL=test@... SHOTS_PASSWORD=... node scripts/support-screenshots.mjs
//
// Optional: SHOTS_SERVER=<server id> (otherwise the account's first server),
// SHOTS_ONLY=adres,konsola. Keep the password in deploy/.env or your shell, never in the repo.
// Needs Playwright with Chromium: npm i -g playwright && npx playwright install chromium,
// then run with NODE_PATH=$(npm root -g).
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Playwright isn't a dependency of the site: install it where you run this (npm i -g playwright), found via NODE_PATH too.
const { chromium } = createRequire(import.meta.url)("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = JSON.parse(readFileSync(join(root, "src/lib/supportScreens.json"), "utf8"));
const base = (process.env.SHOTS_URL ?? "http://localhost:3000").replace(/\/$/, "");
const { SHOTS_EMAIL: email, SHOTS_PASSWORD: password } = process.env;
const only = process.env.SHOTS_ONLY?.split(",");
if (!email || !password) {
  console.error("Set SHOTS_EMAIL and SHOTS_PASSWORD (a test account).");
  process.exit(1);
}
const out = join(root, "public/pomoc");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 760 }, locale: "pl-PL" })).newPage();
await page.goto(`${base}/login`);
await page.fill('input[type="email"]', email);
await page.fill('input[type="password"]', password);
await page.click('form button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 60_000 });

let server = process.env.SHOTS_SERVER;
if (!server) {
  await page.goto(`${base}/dashboard`);
  const href = await page.locator('a[href^="/dashboard/servers/"]').first().getAttribute("href");
  server = href?.split("/")[3];
}
if (!server) throw new Error("The test account has no server.");

for (const shot of shots) {
  if (only && !only.includes(shot.key)) continue;
  await page.goto(`${base}/dashboard/servers/${server}/${shot.path}`, { timeout: 90_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  // Nothing that isn't the panel: the help bubble, cookie notes, dev overlays, and whatever the shot hides.
  await page.addStyleTag({
    content: `.help-fab,.help-sleep,.help-tip,.help-panel,nextjs-portal,[data-nextjs-toast]{display:none!important} ${(shot.hide ?? []).join(",") || "x-none"}{display:none!important}`,
  });
  const target = page.locator(shot.highlight).first();
  try {
    await target.waitFor({ timeout: 15_000 });
  } catch {
    console.error(`${shot.key}: "${shot.highlight}" not found on /${shot.path}, skipped`);
    continue;
  }
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -160));
  const box = await target.boundingBox();
  if (!box) continue;
  // A red outline and an arrow pointing at it, drawn over the page.
  await page.evaluate(({ x, y, width, height }) => {
    const pad = 6;
    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "fixed", left: `${x - pad}px`, top: `${y - pad}px`, width: `${width + pad * 2}px`, height: `${height + pad * 2}px`,
      border: "4px solid #ff3b3b", borderRadius: "12px", boxShadow: "0 0 0 4px rgba(255,59,59,.25), 0 0 24px rgba(255,59,59,.6)", zIndex: 99999, pointerEvents: "none",
    });
    const arrow = document.createElement("div");
    // Above the target pointing down when there's room (buttons often sit side by side), else to its left.
    const above = y - pad - 50 > 0;
    arrow.textContent = above ? "👇" : "👉";
    Object.assign(arrow.style, above
      ? { position: "fixed", left: `${x + Math.min(width, 120) / 2 - 22}px`, top: `${y - pad - 50}px`, fontSize: "40px", zIndex: 99999, pointerEvents: "none" }
      : { position: "fixed", left: `${Math.max(4, x - pad - 52)}px`, top: `${y + height / 2 - 22}px`, fontSize: "40px", zIndex: 99999, pointerEvents: "none" });
    document.body.append(ring, arrow);
  }, box);
  await page.screenshot({ path: join(out, `${shot.key}.png`) });
  console.log(`${shot.key}.png`);
}
await browser.close();
