import { date } from "./format.ts";

/** Opens the browser's print window with a 4 × 2.5 inch label for a job's parts or bin. */
export function printLabel(l: { jobNumber: string; part: string; name: string; customer: string | null; quantity: number; dueDate: string | null; operation?: string }) {
  const w = window.open("", "_blank", "width=480,height=360");
  if (!w) return;
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  w.document.write(`<!doctype html><title>Label ${esc(l.jobNumber)}</title>
<style>@page{size:4in 2.5in;margin:0}body{font:14px system-ui,sans-serif;margin:0;padding:.25in}h1{font-size:32px;margin:0}p{margin:.2em 0}.m{color:#555}</style>
<h1>${esc(l.jobNumber)}</h1>
<p><b>${esc(l.part)}</b></p>
<p>${esc(l.name)}</p>
<p class="m">${esc(l.customer ?? "Stock")} · Qty ${l.quantity} · Due ${esc(date(l.dueDate))}${l.operation ? ` · ${esc(l.operation)}` : ""}</p>`);
  w.document.close();
  w.focus();
  w.print();
}
