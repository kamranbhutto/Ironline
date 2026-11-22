// Records the Packing studio walkthrough. Each scene lasts as long as its narration.
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



const ITEM = "377a107b-a21e-4898-9a94-760945f9de88"; // DMW-1040 drive hub, with a STEP model
const JOB = "e57fdec7-b7e3-4243-80a8-d08bb861c761"; // J-00005, a job for that part
const row = (i) => page.locator("tbody tr").nth(i);

await page.setContent(`<!doctype html><html><head><style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:'DejaVu Sans',Arial,sans-serif;background:radial-gradient(circle at 30% 20%,#2a4ab8,#13204f 70%);color:#fff}
  .w{max-width:1150px;padding:0 60px}.k{display:inline-block;background:#f5c518;color:#13204f;font-weight:700;border-radius:8px;padding:6px 14px;font-size:22px;letter-spacing:.5px}
  h1{font-size:58px;line-height:1.08;margin:28px 0 18px}p{font-size:26px;opacity:.85;margin:0 0 40px}
  ol{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:0;margin:0;list-style:none;counter-reset:s}
  li{counter-increment:s;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:18px;font-size:20px}
  li:before{content:counter(s);display:block;font-size:34px;font-weight:700;color:#f5c518;margin-bottom:6px}
</style></head><body><div class="w"><span class="k">IRONLINE · NEW MODULE</span>
<h1>Packing studio<br>The cheapest way to pack<br>and ship every part</h1><p>Container, pallet and truck, compared on cost per part.</p>
<ol><li>Measure the part from its 3D model</li><li>Compare containers, pallets and trucks</li><li>Find the best carton size</li><li>Save it for the part and its jobs</li></ol></div></body></html>`);
await sleep(600);

await scene("01_title", async () => {
  await sleep(4000);
  await page.mouse.move(500, 700, { steps: 30 });
  await sleep(5000);
  await page.mouse.move(1300, 760, { steps: 40 });
});

const card = (i) => page.locator('ul[aria-label="Packing options"] > li').nth(i).locator("button");
const view = () => page.locator("[data-packview]");

await scene("02_open", async () => {
  await page.goto(BASE + "/");
  await page.getByRole("link", { name: "Packaging" }).waitFor();
  await sleep(700);
  await click(page.getByRole("link", { name: "Packaging" }));
  await page.getByLabel("Length mm", { exact: true }).waitFor();
  await sleep(1500);
  await moveTo(btn("Configure"));
  await sleep(1500);
  await page.mouse.move(900, 450, { steps: 25 });
  await sleep(1500);
  await moveTo(page.getByRole("heading", { name: "Packaging options" }));
  await sleep(1500);
  await moveTo(page.getByLabel("Part", { exact: true }));
  await page.getByLabel("Part", { exact: true }).selectOption(ITEM);
  await page.getByRole("button", { name: "Measure from the 3D model" }).waitFor();
});

await scene("03_measure", async () => {
  await click(btn("Measure from the 3D model"));
  await page.getByText(/^Measured /).waitFor({ timeout: 60000 });
  await sleep(1200);
  await moveTo(page.getByLabel("Height mm", { exact: true }));
  await sleep(800);
  await type(page.getByLabel("Weight kg", { exact: true }), "1.2");
});

await scene("04_options", async () => {
  await moveTo(page.getByRole("heading", { name: "Packaging options" }));
  await sleep(1800);
  await moveTo(card(0));
  await sleep(3000);
  await moveTo(card(1));
  await sleep(1500);
  await moveTo(card(2));
  await sleep(2000);
  await moveTo(card(0));
});

await scene("05_method", async () => {
  await moveTo(page.getByText("Flat layers", { exact: true }));
  await sleep(3000);
  await click(page.getByText("One per cell", { exact: true }));
  await sleep(3500);
  await moveTo(view());
  await sleep(2500);
  await moveTo(page.getByText("Nested stacks", { exact: true }));
  await sleep(2500);
  await moveTo(page.getByLabel(/^Clearance mm/));
  await sleep(1500);
  await moveTo(page.getByLabel(/^Divider mm/));
});

await scene("06_3d", async () => {
  await click(btn("Hide dividers"));
  await sleep(1000);
  await click(btn("Show dividers"));
  const slider = page.locator('input[type=range]');
  await moveTo(slider);
  await slider.fill("0.6");
  await sleep(1200);
  await slider.fill("0");
  await click(page.getByRole("tab", { name: "Pallet" }));
  await sleep(1800);
  await click(page.getByRole("tab", { name: "Truck" }));
  await sleep(1000);
  const v = await view().boundingBox();
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(v.x + v.width / 2 + 180, v.y + v.height / 2 + 30, { steps: 40 });
  await page.mouse.up();
  await sleep(500);
  await page.mouse.move(v.x + v.width - 60, v.y + 60, { steps: 20 });
  await sleep(800);
  await click(page.getByRole("tab", { name: "Box" }));
});

await scene("07_results", async () => {
  await click(btn("Results"));
  await sleep(1500);
  await moveTo(page.locator("aside").first().getByText("Inside", { exact: true }).first());
  await sleep(2500);
  await moveTo(page.getByText("Load on the bottom one").first());
  await sleep(2500);
  const pane = page.locator("aside").first().locator(".overflow-y-auto").first();
  await pane.evaluate((e) => e.scrollTo({ top: e.scrollHeight, behavior: "smooth" }));
  await sleep(2500);
  await moveTo(page.getByText("Space used").first());
});

await scene("08_fit", async () => {
  await click(btn("Find best carton size"));
  await sleep(1500);
  await moveTo(card(0));
  await sleep(3500);
  await moveTo(card(0).getByText("Made to size"));
  await sleep(2000);
  await moveTo(view());
});

await scene("09_rank", async () => {
  await click(btn("Most per truck"));
  await sleep(1900);
  await click(btn("Lowest cost"));
  await sleep(800);
  await click(btn("Ignore weight"));
  await sleep(2200);
  await click(btn("Weight limits on"));
});

await scene("10_roi", async () => {
  await click(btn("Configure"));
  await sleep(600);
  await click(btn("Packing"));
  await click(btn("Part"));
  await click(btn("Returnables"));
  await sleep(1200);
  await moveTo(page.getByLabel(/^Parts a year/));
  await sleep(2500);
  await moveTo(page.getByText("Fleet needed"));
  await sleep(2500);
  await moveTo(page.getByText("Pays back in"));
});

await scene("11_report", async () => {
  await click(btn("Results"));
  await sleep(600);
  await click(btn("Report"));
  await page.getByText("Print or save as PDF").waitFor({ timeout: 30000 });
  await sleep(800);
  await type(page.getByLabel("Title", { exact: true }), "Drive hub packing");
  await sleep(300);
  const pane = page.locator("dialog[open] .overflow-y-auto");
  for (const top of [500, 1100, 99999]) {
    await pane.evaluate((e, t) => e.scrollTo({ top: t, behavior: "smooth" }), top);
    await sleep(1300);
  }
  await moveTo(btn("Print or save as PDF"));
  await sleep(500);
  await click(page.locator("dialog[open]").getByText("Close", { exact: true }));
});

await scene("12_save", async () => {
  await click(btn("Use for part"));
  await sleep(700);
  await page.goto(`${BASE}/items/${ITEM}`);
  await page.getByRole("tab", { name: "Packing" }).waitFor();
  await sleep(500);
  await click(page.getByRole("tab", { name: "Packing" }));
  await sleep(1600);
  await page.goto(`${BASE}/jobs/${JOB}`);
  await page.getByText(/containers? for this job/).waitFor();
  await sleep(800);
  await moveTo(page.getByText(/containers? for this job/));
});

await scene("13_library", async () => {
  await page.goto(`${BASE}/packaging`);
  await page.getByText("Containers, pallets and trucks").waitFor();
  await sleep(1500);
  await moveTo(page.locator("tbody tr", { hasText: "TOTE-6428" }));
  await sleep(2500);
  await moveTo(page.locator("tbody tr", { hasText: "PAL-1208" }));
  await sleep(1500);
  await moveTo(btn("Add"));
});

await scene("14_outro", async () => {
  await click(page.getByRole("link", { name: "Open packing studio" }));
  await page.getByLabel("Part", { exact: true }).waitFor();
  await page.getByLabel("Part", { exact: true }).selectOption(ITEM);
  await view().waitFor({ timeout: 30000 });
  await sleep(1500);
  await moveTo(view());
});

await sleep(1000);
const total = (Date.now() - t0) / 1000;
await context.close();
const videoPath = await page.video().path();
writeFileSync("marks.json", JSON.stringify({ marks, total, videoPath }, null, 1));
await browser.close();
console.log("recorded", total.toFixed(1), "s ->", videoPath);
