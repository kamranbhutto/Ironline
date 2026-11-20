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
  await page.keyboard.type(text, { delay: 32 });
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



await sleep(800);
const P = process.env.PREFIX ?? "SB-200";
const CUSTOMER = "0c65bd95-53a7-4879-8631-4bc34f4cafd2"; // Northwind Robotics
const dlg = () => page.locator("dialog[open]");
const libAdd = (text) => page.locator("li", { hasText: text }).getByRole("button", { name: "+ Add" });
async function step(wcCode, instructions, setup, runMin) {
  await click(libAdd(wcCode));
  await type(page.getByLabel("Instructions for the operator"), instructions);
  if (setup) await type(page.getByLabel("Setup (hours, once)"), setup);
  await type(page.getByLabel("Run (minutes / piece)"), runMin);
  await sleep(400);
  await click(page.getByRole("button", { name: "Close operation settings" }));
}

// Title card: a clean opening before the app appears.
await page.setContent(`<!doctype html><html><head><style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:'DejaVu Sans',Arial,sans-serif;background:radial-gradient(circle at 30% 20%,#2a4ab8,#13204f 70%);color:#fff}
  .w{max-width:1100px;padding:0 60px}.k{display:inline-block;background:#f5c518;color:#13204f;font-weight:700;border-radius:8px;padding:6px 14px;font-size:22px;letter-spacing:.5px}
  h1{font-size:66px;line-height:1.08;margin:28px 0 18px}p{font-size:26px;opacity:.85;margin:0 0 40px}
  ol{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:0;margin:0;list-style:none;counter-reset:s}
  li{counter-increment:s;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:18px;font-size:20px}
  li:before{content:counter(s);display:block;font-size:34px;font-weight:700;color:#f5c518;margin-bottom:6px}
</style></head><body><div class="w"><span class="k">IRONLINE · HOW-TO</span>
<h1>One product, four pieces:<br>route each piece, then assemble</h1><p>Make every piece on its own routing and let the assembly wait for them.</p>
<ol><li>Create each piece as a part</li><li>Give each piece its routing</li><li>Build the assembly from the pieces</li><li>Quote, order and release: piece jobs are made for you</li></ol></div></body></html>`);
await sleep(600);

await scene("01_title", async () => {
  await sleep(3000);
  await page.mouse.move(500, 700, { steps: 30 });
  await sleep(4000);
  await page.mouse.move(1300, 760, { steps: 40 });
});

await scene("02_piece", async () => {
  await page.goto(BASE + "/items");
  await page.getByRole("link", { name: /Add part/ }).first().waitFor();
  await sleep(800);
  await click(page.getByRole("link", { name: /Add part/ }).first());
  await page.getByLabel("Part number").waitFor();
  await type(page.getByLabel("Part number"), `${P}-1`);
  await type(page.getByLabel("Description").first(), "Back frame, laser cut and formed");
  await moveTo(page.getByLabel("Type").first());
  await sleep(800);
});

await scene("03_routing", async () => {
  await click(btn("Edit"));
  await click(page.getByRole("tab", { name: "Operations" }));
  await step("LASER", "Cut frame blank from 3 mm sheet", "0.3", "4");
  await step("BRAKE", "Form the two side flanges", "0.5", "3");
  await step("DEB", "Deburr all edges", "", "2");
});

await scene("04_save_piece", async () => {
  await click(btn("Done editing"));
  await click(btn("Save part"));
  await page.waitForURL(/\/items\/[0-9a-f-]{36}/);
  await sleep(1200);
  await moveTo(page.getByRole("heading", { name: /Bill of materials/ }));
  await sleep(800);
  await page.mouse.wheel(0, 250);
});

await scene("05_others", async () => {
  await page.goto(BASE + "/items");
  const search = page.locator("main input[type=search]").first();
  await search.waitFor();
  await type(search, P);
  await sleep(1500);
  for (const n of [2, 3, 4]) {
    await moveTo(page.getByText(`${P}-${n}`, { exact: true }).first());
    await sleep(1200);
  }
});

await scene("06_assembly", async () => {
  await click(page.getByRole("link", { name: /Add part/ }).first());
  await page.getByLabel("Part number").waitFor();
  await type(page.getByLabel("Part number"), P);
  await type(page.getByLabel("Description").first(), "Seat back assembly");
  await click(btn("Edit"));
  await type(page.getByLabel("Search the library"), `${P}-`);
  await sleep(600);
  for (const n of [1, 2, 3, 4]) {
    await click(libAdd(`${P}-${n}`));
    await sleep(300);
  }
});

await scene("07_asm_ops", async () => {
  await click(page.getByRole("tab", { name: "Operations" }));
  await click(page.getByLabel("Search the library"));
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await sleep(300);
  await step("ASM", "Fit frame, shell, plate and brackets; torque bolts", "0.25", "12");
  await step("Final inspection", "Check fit, fasteners and finish", "", "5");
  await click(btn("Done editing"));
  await click(btn("Save part"));
  await page.waitForURL(/\/items\/[0-9a-f-]{36}/);
});

await scene("08_tree", async () => {
  await moveTo(page.getByRole("heading", { name: /Bill of materials/ }));
  await click(btn("Expand all"));
  await sleep(1500);
  await page.mouse.wheel(0, 380);
  await sleep(1500);
  await moveTo(page.getByText(`${P}-2`, { exact: true }).first());
  await sleep(1500);
  await page.mouse.wheel(0, 380);
});

await scene("09_quote", async () => {
  await page.goto(BASE + `/customers/${CUSTOMER}`);
  await page.getByRole("link", { name: "New quote", exact: true }).waitFor();
  await click(page.getByRole("link", { name: "New quote", exact: true }));
  await page.getByText("New quote").first().waitFor();
  await sleep(800);
  const part = page.locator('select:has(option:text-is("One-off part"))');
  await moveTo(part);
  await part.selectOption({ label: `${P} rev A` });
  await sleep(1500);
  await type(page.getByLabel("Quantity", { exact: true }), "10");
  await sleep(1200);
  await moveTo(page.getByText("Quote total").first());
});

await scene("10_order", async () => {
  await click(btn("Save quote"));
  await btn("Mark as sent").waitFor();
  await click(btn("Mark as sent"));
  await page.getByRole("button", { name: /^Won/ }).waitFor();
  await click(page.getByRole("button", { name: /^Won/ }).first());
  await type(page.getByLabel("Customer PO number"), "NWR-5520");
  await click(btn("Create sales order"));
  await page.waitForURL(/sales-orders\//);
  await sleep(1000);
});

let assemblyUrl = "";
await scene("11_job", async () => {
  await click(page.locator('a[href^="/jobs/"]').first());
  await page.getByText("Pieces for this assembly").waitFor();
  assemblyUrl = page.url();
  await sleep(800);
  await moveTo(page.getByText("Pieces for this assembly"));
  await sleep(1500);
  for (const n of [1, 2, 3, 4]) {
    await moveTo(page.locator('a[href^="/jobs/"]').filter({ hasText: `${P}-${n} ` }).first());
    await sleep(900);
  }
});

await scene("12_release", async () => {
  await page.mouse.wheel(0, -2000);
  await sleep(500);
  await click(btn("Release to shop"));
  await sleep(1500);
  await moveTo(page.getByText("Assembly waits until every piece is finished"));
  await sleep(2000);
});

await scene("13_piece_job", async () => {
  await click(page.locator('a[href^="/jobs/"]').filter({ hasText: `${P}-1 ` }).first());
  await page.getByText(/Piece of/).first().waitFor();
  await sleep(800);
  await moveTo(page.getByText(/Piece of/).first());
  await sleep(2000);
  await page.mouse.wheel(0, 900);
  await sleep(1500);
  await moveTo(page.getByText("Cut frame blank from 3 mm sheet").first());
});

await scene("14_board", async () => {
  await page.goto(BASE + "/floor/board");
  await page.getByText("Schedule —").first().waitFor();
  await sleep(1500);
  await moveTo(page.getByText(new RegExp(`-1$`)).first()).catch(() => {});
  await sleep(1500);
});

await scene("15_old_job", async () => {
  await page.goto(assemblyUrl);
  await page.getByText("Pieces for this assembly").waitFor();
  await sleep(800);
  await moveTo(btn("Copy routing from the part"));
  await sleep(2500);
  await moveTo(page.getByRole("link", { name: /Edit part routing/ }));
});

await scene("16_outro", async () => {
  await moveTo(page.getByText("Pieces for this assembly"));
  await sleep(3000);
});

await sleep(1000);
const total = (Date.now() - t0) / 1000;
await context.close();
const videoPath = await page.video().path();
writeFileSync("marks.json", JSON.stringify({ marks, total, videoPath }, null, 1));
await browser.close();
console.log("recorded", total.toFixed(1), "s ->", videoPath);
