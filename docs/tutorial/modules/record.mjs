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
const tab = (name) => page.getByRole("tab", { name, exact: true });
const dlg = () => page.locator("dialog[open]");
const PART = "377a107b-a21e-4898-9a94-760945f9de88";
const J2 = "e7b7ce9c-3686-4af8-9094-44c0d1c881aa";
const J2_OP20 = "cfff6b32-3878-42f8-8aa9-659003738b64";
const J3_OP20 = "1ebd7b1f-7768-4b6a-94d6-ae6562da7ff0";
const BAR = "7de4d829-53e0-4847-b63f-bb34109b36ee";
const PO1 = "40358344-2b84-4d61-a370-ace0f2aa5c92";
const REPORT = "d31a919e-ee18-49ac-9ef1-675668cef9b9";
const go = async (path, text) => {
  await page.goto(BASE + path);
  await page.getByText(text).first().waitFor();
  await sleep(700);
};

await go("/", "Shop load");

await scene("01_intro", async () => {
  await sleep(2500);
  await moveTo(page.getByText("Job cost: estimate vs actual").first());
  await sleep(2500);
  await page.mouse.wheel(0, -2000);
});

await scene("02_plan", async () => {
  await go(`/items/${PART}`, "Inspection plan");
  await moveTo(page.getByRole("heading", { name: "Inspection plan" }));
  await sleep(1200);
  await page.mouse.wheel(0, 260);
  await sleep(800);
  await moveTo(btn("Add balloons"));
  await sleep(2500);
  await click(page.getByRole("button", { name: /^4 ⌀/ }));
  await sleep(2500);
  await moveTo(page.getByLabel("How often"));
  await sleep(1500);
  await moveTo(page.getByLabel("Gauge or tool"));
});

await scene("03_inspect", async () => {
  await go(`/floor/op/${J2_OP20}`, "Parts done");
  await click(page.locator("nav[aria-label=Panels] button", { hasText: "Inspect" }));
  await page.getByLabel("Reading for balloon 4").waitFor();
  await sleep(2500);
  await type(page.getByLabel("Reading for balloon 4"), "0.7512");
  await sleep(1500);
  await moveTo(page.getByText("Out of tolerance").first());
});

await scene("04_history", async () => {
  await click(page.getByRole("button", { name: "Show all pieces" }));
  await sleep(2500);
  await moveTo(page.getByText("due").first());
});

await scene("05_job_quality", async () => {
  await go(`/jobs/${J2}`, "Details");
  await click(tab("Quality"));
  await page.getByText("Lowest Cpk").waitFor();
  await sleep(1000);
  await page.mouse.wheel(0, 380);
  await sleep(1500);
  await moveTo(page.getByText("0.753").first());
  await sleep(2000);
  await moveTo(page.getByText("Download CSV").first());
});

await scene("06_report", async () => {
  await click(tab("Report"));
  await sleep(1500);
  await moveTo(page.locator("iframe[title='Inspection report']"));
  await sleep(1500);
  await moveTo(btn("Print or save as PDF"));
});

await scene("07_quality_page", async () => {
  await go("/quality", "Out of tolerance this week");
  await sleep(1200);
  await moveTo(page.getByText("Out of tolerance this week").first());
  await sleep(2000);
  await moveTo(page.getByRole("heading", { name: "Jobs being inspected" }));
});

await scene("08_inventory", async () => {
  await go("/inventory", "Stock value");
  await sleep(1500);
  await moveTo(page.getByText("On order", { exact: true }).first());
  await sleep(1500);
  await moveTo(page.getByText("Needed by jobs", { exact: true }).first());
  await sleep(1500);
  await click(btn("Remnants"));
  await sleep(1500);
  await click(btn("All"));
});

await scene("09_item_stock", async () => {
  await go(`/inventory/${BAR}`, "Reorder point");
  await sleep(1000);
  await moveTo(page.getByText("Remnant", { exact: true }).first());
  await sleep(2500);
  await click(page.getByRole("button", { name: "Transactions" }));
  await sleep(3500);
  await click(page.getByRole("button", { name: "Certificates" }));
  await sleep(1500);
});

await scene("10_pick", async () => {
  await go(`/floor/op/${J3_OP20}`, "Parts done");
  await click(page.locator("nav[aria-label=Panels] button", { hasText: "Pick" }));
  await sleep(1500);
  await moveTo(page.getByText("L-00001").first());
  await sleep(2000);
  await click(btn("Save remnant"));
  await sleep(2500);
  await page.keyboard.press("Escape");
});

await scene("11_stock_take", async () => {
  await go("/inventory/stock-take", "Download the stock sheet");
  await moveTo(btn("Download sheet"));
  await sleep(2000);
  await moveTo(btn("Choose counted sheet"));
  await sleep(2000);
  await moveTo(page.getByText("Check and save the changes"));
});

await scene("12_plan", async () => {
  await go("/purchasing", "Can't arrive in time");
  await sleep(1500);
  await moveTo(page.getByText("Can't arrive in time").first());
  await sleep(1500);
  await click(page.getByRole("button", { name: /Covered/ }));
  await sleep(1500);
  await moveTo(page.getByText("Vendor & lead time").first());
});

await scene("13_supply", async () => {
  await click(page.getByRole("button", { name: /^AL6061-RD-2/ }));
  await dlg().getByText("Projected").waitFor();
  await sleep(1500);
  await moveTo(dlg().locator("svg[aria-label='Projected stock over time']"));
  await sleep(2500);
  await click(dlg().getByRole("button", { name: "Vendors", exact: true }));
  await sleep(3000);
  await click(dlg().getByRole("button", { name: "Close" }));
});

await scene("14_basket", async () => {
  await type(page.getByLabel("Quantity to buy of PEM-S-832-2"), "1000");
  await click(page.locator("tr", { hasText: "PEM-S-832-2" }).getByRole("button", { name: "Add", exact: true }));
  await sleep(1200);
  await click(btn("Create order"));
  await sleep(2500);
  await moveTo(dlg().getByText("Arrives by"));
  await sleep(1500);
  await click(dlg().getByRole("button", { name: "Cancel" }));
  await sleep(500);
  await click(btn("Clear"));
});

await scene("15_po", async () => {
  await go(`/purchasing/orders/${PO1}`, "Receipts");
  await sleep(1500);
  await moveTo(page.getByText("Partly received").first());
  await sleep(1500);
  await moveTo(page.getByText("Receipts").first());
  await sleep(1500);
  await moveTo(page.getByText("L-00006").first());
});

await scene("16_reports", async () => {
  await go("/reports", "Start from a ready-made report");
  await sleep(1200);
  await moveTo(page.getByText("Labor hours by work center").first());
  await sleep(1500);
  await moveTo(page.getByText("Spend by vendor").first());
  await sleep(1500);
  await moveTo(page.getByRole("heading", { name: "Saved reports" }));
});

await scene("17_builder", async () => {
  await go(`/reports/${REPORT}`, "Show as");
  await sleep(1200);
  await click(btn("Top customers"));
  await sleep(1500);
  const show = page.getByLabel("Show as");
  await moveTo(show);
  await show.selectOption("pie");
  await sleep(2500);
  await moveTo(page.getByText("Slices by").first());
  await sleep(1200);
  await moveTo(page.getByText("Filters", { exact: true }).first());
  await sleep(1200);
  await moveTo(btn("Export CSV"));
});

await scene("18_outro", async () => {
  await go("/", "Shop load");
  await sleep(800);
  await moveTo(page.getByText("Job cost: estimate vs actual").first());
  await sleep(3000);
});

await sleep(1000);
const total = (Date.now() - t0) / 1000;
await context.close();
const videoPath = await page.video().path();
writeFileSync("marks.json", JSON.stringify({ marks, total, videoPath }, null, 1));
await browser.close();
console.log("recorded", total.toFixed(1), "s ->", videoPath);
