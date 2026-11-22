// Records the Packaging walkthrough. Each scene lasts as long as its narration.
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
  h1{font-size:64px;line-height:1.08;margin:28px 0 18px}p{font-size:26px;opacity:.85;margin:0 0 40px}
  ol{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:0;margin:0;list-style:none;counter-reset:s}
  li{counter-increment:s;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:18px;font-size:20px}
  li:before{content:counter(s);display:block;font-size:34px;font-weight:700;color:#f5c518;margin-bottom:6px}
</style></head><body><div class="w"><span class="k">IRONLINE · NEW MODULE</span>
<h1>Packaging: the cheapest way<br>to pack and ship every part</h1><p>Container, pallet and truck, compared on cost per part.</p>
<ol><li>Measure the part from its 3D model</li><li>Compare containers, pallets and trucks</li><li>Find the best carton size</li><li>Save it for the part and its jobs</li></ol></div></body></html>`);
await sleep(600);

await scene("01_title", async () => {
  await sleep(4000);
  await page.mouse.move(500, 700, { steps: 30 });
  await sleep(5000);
  await page.mouse.move(1300, 760, { steps: 40 });
});

await scene("02_open", async () => {
  await page.goto(BASE + "/");
  await page.getByRole("link", { name: "Packaging" }).waitFor();
  await sleep(700);
  await click(page.getByRole("link", { name: "Packaging" }));
  await page.getByLabel("Length mm", { exact: true }).waitFor();
  await sleep(1200);
  await moveTo(page.getByRole("navigation", { name: "Study settings" }));
  await sleep(1500);
  await moveTo(page.locator("section").filter({ has: page.locator("svg.lucide-boxes") }).first()).catch(() => {});
  await sleep(1200);
  await moveTo(page.getByRole("heading", { name: "Options" }));
  await sleep(1000);
  await moveTo(page.locator("select").first());
  await page.locator("select").first().selectOption(ITEM);
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

const card = (i) => page.locator('ul[aria-label="Packing options"] > li').nth(i).locator("button");
await scene("04_options", async () => {
  await moveTo(page.getByRole("heading", { name: "Options" }));
  await sleep(1800);
  await moveTo(card(0));
  await sleep(3500);
  await moveTo(card(1));
  await sleep(2500);
  await moveTo(card(0).getByText(/Limited by/)).catch(() => {});
});

await scene("05_method", async () => {
  await click(btn("Packing"));
  await sleep(1200);
  await moveTo(page.getByText("Flat layers", { exact: true }));
  await sleep(2400);
  await moveTo(page.getByText("One per cell", { exact: true }));
  await sleep(2400);
  await moveTo(page.getByText("Nested stacks", { exact: true }));
  await sleep(2200);
  await moveTo(page.getByLabel(/^Clearance mm/));
  await sleep(1500);
  await moveTo(page.getByLabel(/^Layer pad mm/));
  await sleep(1300);
  await moveTo(page.getByLabel(/^Lift limit kg/));
});

await scene("06_3d", async () => {
  await click(card(0));
  await moveTo(page.locator("[data-packview]"));
  await sleep(1200);
  const slider = page.locator('input[type=range]');
  await moveTo(slider);
  await slider.fill("0.7");
  await sleep(1800);
  await slider.fill("0");
  await click(page.getByRole("tab", { name: "Pallet" }));
  await sleep(2400);
  await click(page.getByRole("tab", { name: "Truck" }));
  await sleep(1500);
  const v = await page.locator("[data-packview]").boundingBox();
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(v.x + v.width / 2 + 160, v.y + v.height / 2 + 20, { steps: 40 });
  await page.mouse.up();
});

await scene("07_cost", async () => {
  await moveTo(page.getByText("Cost per part and instruction"));
  await sleep(4500);
  await click(btn("Shipping"));
  await sleep(1200);
  await type(page.getByLabel(/^Parts in this shipment/), "500");
  await sleep(800);
  await moveTo(page.getByText(/^500 parts:/).first()).catch(() => {});
});

await scene("08_fit", async () => {
  await type(page.getByLabel(/^Parts in this shipment/), "0");
  await click(page.getByRole("tab", { name: "Inside" }));
  await sleep(400);
  await click(btn("Find best carton size"));
  await sleep(1500);
  await moveTo(card(0));
  await sleep(3500);
  await moveTo(page.locator("[data-packview]"));
});

await scene("09_roi", async () => {
  await click(btn("Payback"));
  await sleep(1500);
  await moveTo(page.getByLabel(/^Parts a year/));
  await sleep(2500);
  await moveTo(page.getByText("Fleet needed"));
  await sleep(2500);
  await moveTo(page.getByText("Pays back in"));
});

await scene("10_save", async () => {
  await click(btn("Use for part"));
  await page.getByText("Saved", { exact: true }).waitFor();
  await sleep(1200);
  await click(btn("Part"));
  await sleep(1000);
  await moveTo(page.getByText("Saved packing for this part"));
  await sleep(2500);
  await moveTo(btn("Report"));
});

await scene("11_part_job", async () => {
  await page.goto(`${BASE}/items/${ITEM}`);
  await page.getByRole("tab", { name: "Packing" }).waitFor();
  await sleep(600);
  await click(page.getByRole("tab", { name: "Packing" }));
  await sleep(2600);
  await page.goto(`${BASE}/jobs/${JOB}`);
  await page.getByText("Packing", { exact: true }).first().waitFor();
  await sleep(800);
  await moveTo(page.getByText(/containers? for this job/));
});

await scene("12_library", async () => {
  await page.goto(`${BASE}/packaging?view=library`);
  await page.getByText("Containers, pallets and trucks").waitFor();
  await sleep(1500);
  await moveTo(page.locator("tbody tr", { hasText: "TOTE-6428" }));
  await sleep(2500);
  await moveTo(page.locator("tbody tr", { hasText: "PAL-1208" }));
  await sleep(2000);
  await moveTo(btn("Add"));
});

await scene("13_outro", async () => {
  await page.goto(`${BASE}/packaging?item=${ITEM}`);
  await page.locator("[data-packview]").waitFor();
  await sleep(1000);
  await moveTo(page.locator("[data-packview]"));
});

await sleep(1000);
const total = (Date.now() - t0) / 1000;
await context.close();
const videoPath = await page.video().path();
writeFileSync("marks.json", JSON.stringify({ marks, total, videoPath }, null, 1));
await browser.close();
console.log("recorded", total.toFixed(1), "s ->", videoPath);
