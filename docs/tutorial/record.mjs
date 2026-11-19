// Records the Ironline walkthrough. Each scene lasts as long as its narration clip.
import { chromium } from "/home/kamran/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:5180";
const dur = JSON.parse(readFileSync("durations.json", "utf8"));
const GAP = 0.7; // seconds of quiet between scenes
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, executablePath: "/home/kamran/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", args: ["--window-size=1600,990", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: "video", size: { width: 1600, height: 900 } } });
// Demo shop login from the project's seed file (local development only).
const seed = readFileSync("/media/kamran/kamran_data/softwarecopy/ironline-erp/apps/api/src/db/seed.ts", "utf8");
const email = seed.match(/email: "([^"]+)"/)[1];
const password = seed.match(/password: "([^"]+)"/)[1];
const login = await context.request.post(`${BASE}/api/v1/auth/login`, { data: { email, password } });
if (!login.ok()) throw new Error(`login failed ${login.status()}`);

// A visible cursor and click ripple, since headless recordings have no pointer.
await context.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = "position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;transition:transform .08s";
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.6L21 10.8z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => (c.style.left = e.clientX + "px", c.style.top = e.clientY + "px"), true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.style.cssText = `position:fixed;z-index:2147483646;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #f59e0b;pointer-events:none;transition:all .45s ease-out;opacity:1`;
      document.body.appendChild(r);
      requestAnimationFrame(() => (r.style.transform = "scale(1.8)", r.style.opacity = "0"));
      setTimeout(() => r.remove(), 500);
      c.style.transform = "scale(.85)";
      setTimeout(() => (c.style.transform = ""), 120);
    }, true);
  });
});

const page = await context.newPage();
const t0 = Date.now();
let mouse = { x: 960, y: 540 };
const marks = [];

async function moveTo(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box");
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y, { steps: 25 });
  mouse = { x, y };
  await sleep(250);
}
async function click(loc) {
  await moveTo(loc);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(500);
}
async function type(loc, text) {
  await click(loc);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text, { delay: 55 });
  await sleep(300);
}
async function scene(id, fn) {
  const start = (Date.now() - t0) / 1000;
  marks.push({ id, start });
  await fn();
  const left = start + dur[id] + GAP - (Date.now() - t0) / 1000;
  if (left > 0) await sleep(left * 1000);
  else console.log(`scene ${id} ran ${(-left).toFixed(1)}s longer than its narration`);
}
const btn = (name, exact = true) => page.getByRole("button", { name, exact });

await page.goto(BASE + "/");
await page.getByText("Shop load").first().waitFor();
await sleep(800);

await scene("01_intro", async () => {
  await sleep(4000);
  await moveTo(page.getByText("Open quotes").first());
  await sleep(2000);
  await moveTo(page.getByText("Backlog").first());
  await sleep(2000);
  await moveTo(page.getByText("Shop load").first());
});

await scene("02_customer", async () => {
  await click(page.getByRole("link", { name: "Customers", exact: true }));
  await click(btn("Add customer"));
  await type(page.getByLabel("Company name"), "Brightline Brackets");
  await type(page.getByLabel("E-mail"), "buy@brightline.example");
  await type(page.getByLabel("Phone"), "+1 555 0177");
  await click(btn("Save customer"));
  await page.getByText("Brightline Brackets").first().waitFor();
});

await scene("03_customer_page", async () => {
  await sleep(2500);
  await moveTo(page.getByText("Open quotes").first());
  await sleep(1500);
  await click(page.getByRole("link", { name: "New quote", exact: true }));
});

await scene("04_quote", async () => {
  await page.getByText("New quote").first().waitFor();
  await sleep(1500);
  const part = page.locator('select:has(option:text-is("One-off part"))');
  await moveTo(part);
  await part.selectOption({ label: "DMW-1040 rev A" });
  await sleep(2500);
  await type(page.getByLabel("Quantity", { exact: true }), "100");
  await sleep(1500);
  await moveTo(page.getByText("Quote total").first());
  await sleep(1500);
  await moveTo(page.getByText("Margin").first());
});

await scene("05_send", async () => {
  await click(btn("Save quote"));
  await btn("Mark as sent").waitFor();
  await sleep(800);
  await click(btn("Mark as sent"));
  await page.getByRole("button", { name: /^Won/ }).waitFor();
  await moveTo(page.getByText("Sent to customer").first());
});

await scene("06_won", async () => {
  await click(page.getByRole("button", { name: /^Won/ }).first());
  await type(page.getByLabel("Customer PO number"), "BLB-4410");
  await sleep(600);
  await moveTo(page.getByText("Create a job for every line now").first());
  await sleep(800);
  await click(btn("Create sales order"));
  await page.waitForURL(/sales-orders\//);
});

await scene("07_order", async () => {
  await sleep(1500);
  await moveTo(page.getByText("Order value").first());
  await sleep(1800);
  await click(page.locator('a[href^="/jobs/"]').first());
  await page.waitForURL(/\/jobs\//);
});

await scene("08_job", async () => {
  await sleep(1500);
  await moveTo(page.getByText("Projected margin").first());
  await sleep(2500);
  await moveTo(page.locator("canvas").first());
  await sleep(1500);
  await click(btn("Release to shop"));
  await page.getByRole("link", { name: "Work on it", exact: true }).waitFor();
});

await scene("09_operator", async () => {
  await click(page.getByRole("link", { name: "Work on it", exact: true }));
  await page.waitForURL(/floor\/op\//);
  await sleep(3000);
  await moveTo(page.locator('[title="Setup time"]'));
  await sleep(1500);
  await moveTo(page.getByRole("button", { name: /^Start/ }));
});

await scene("10_setup", async () => {
  await click(page.getByRole("button", { name: /^Start/ }));
  await sleep(4500);
  await click(btn("Pause"));
});

await scene("11_count", async () => {
  await click(btn("Labor"));
  await click(page.getByRole("button", { name: /^Start/ }));
  await type(page.getByLabel("Parts to add with the plus button"), "50");
  const plus = page.getByRole("button", { name: /^Add 50 good parts/ });
  await click(plus);
  await sleep(900);
  await click(plus);
  await sleep(800);
  await moveTo(page.locator('[title="Parts done"]'));
});

await scene("12_pick", async () => {
  await click(page.locator("nav[aria-label=Panels] button", { hasText: "Pick" }));
  await sleep(1200);
  await click(page.locator("aside").getByRole("button", { name: "Pick", exact: true }).first());
});

await scene("13_chat", async () => {
  await click(page.locator("nav[aria-label=Panels] button", { hasText: "Chat" }));
  await type(page.getByLabel("Message"), "@Office saw cuts done, 100 blanks ready for the lathe");
  await page.keyboard.press("Enter");
  await sleep(1200);
  await moveTo(page.getByLabel("Alert reason"));
});

await scene("14_complete", async () => {
  await click(btn("Pause"));
  await click(page.locator("nav[aria-label=Panels] button", { hasText: "Complete" }));
  await sleep(3000);
  const close = page.getByRole("button", { name: "Close operation" });
  await close.scrollIntoViewIfNeeded();
  await sleep(1500);
  await click(close);
  await page.waitForURL(/\/floor(\?|$)/);
});

await scene("15_board", async () => {
  await page.goto(BASE + "/floor/board");
  await page.getByText("Schedule —").first().waitFor();
  await sleep(1500);
  await moveTo(page.getByText("Setup pending").first());
});

await scene("16_outro", async () => {
  await page.goto(BASE + "/");
  await page.getByText("Shop load").first().waitFor();
  await sleep(1500);
  await moveTo(page.getByText("Backlog").first());
  await sleep(2000);
  await moveTo(page.getByText("Open jobs").first());
});

await sleep(1000);
const total = (Date.now() - t0) / 1000;
await context.close();
const videoPath = await page.video().path();
writeFileSync("marks.json", JSON.stringify({ marks, total, videoPath }, null, 1));
await browser.close();
console.log("recorded", total.toFixed(1), "s ->", videoPath);
