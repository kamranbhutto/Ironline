import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, qs, type SalesOrderDetail, type SalesOrderSummary } from "../api.ts";
import { Box, Printer, Truck } from "lucide-react";
import { FilesPanel, type FileRow } from "../components/Files.tsx";
import { useThumb } from "../thumbs.ts";
import { Badge, Button, Card, cx, DetailTitle, ErrorNote, InsetField, ListBar, Loading, MetricCard, Modal, MoreMenu, PageHeader, PillTabs, R, recordCard, SearchBox, StageTimeline, Status, TabPanel, Table, Td, ViewTabs } from "../components/ui.tsx";
import { date, isPast, label, money, num } from "../format.ts";

/** Sales orders; the Shipping menu opens the same list on the orders ready to ship. */
export function SalesOrdersPage({ shipping = false }: { shipping?: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(shipping ? "ready" : "open");
  const nav = useNavigate();
  const list = useQuery({ queryKey: ["sales-orders", status, q], queryFn: () => api<SalesOrderSummary[]>(`/sales-orders${qs({ q, status })}`) });
  return (
    <>
      <PageHeader title={shipping ? "Shipping" : "Sales orders"} sub={shipping ? "Orders whose jobs are finished, ready to ship. Open one and click Ship." : "Confirmed customer orders. Create them from won quotes."} />
      <Card pad={false}>
        <ListBar>
          <ViewTabs views={[{ key: "open", label: "Open" }, { key: "confirmed", label: "Confirmed" }, { key: "in_production", label: "In production" }, { key: "ready", label: "Ready to ship" }, { key: "shipped", label: "Shipped" }, { key: "closed", label: "Closed" }, { key: "", label: "All" }]} value={status} onChange={setStatus} />
          <div className="ml-auto w-full sm:w-72">
            <SearchBox value={q} onChange={setQ} placeholder="Search order, customer or PO" />
          </div>
        </ListBar>
        {list.isLoading ? <Loading /> : (
          <Table head={["Order", "Customer", "Customer PO", "Ordered", "Due", R("Value"), "Status"]} empty="No sales orders. Convert a won quote to create one.">
            {(list.data ?? []).map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-panel-2" onClick={() => nav(`/sales-orders/${o.id}`)}>
                <Td className="font-medium">{o.number}</Td>
                <Td>{o.customerName}</Td>
                <Td className="text-muted">{o.customerPo ?? "—"}</Td>
                <Td>{date(o.orderDate)}</Td>
                <Td className={isPast(o.dueDate) && o.status !== "shipped" && o.status !== "closed" ? "text-bad" : ""}>{date(o.dueDate)}</Td>
                <Td right>{money(o.totalPrice)}</Td>
                <Td><Status value={o.status} text={orderStatusText(o.status)} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export function SalesOrderPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"lines" | "files" | "log">("lines");
  const [fileCount, setFileCount] = useState<number | undefined>();
  const so = useQuery({ queryKey: ["sales-order", id], queryFn: () => api<SalesOrderDetail>(`/sales-orders/${id}`) });
  const [shipOpen, setShipOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const setStatus = useMutation({
    mutationFn: (status: "closed" | "cancelled") => api<SalesOrderDetail>(`/sales-orders/${id}/status`, "POST", { status }),
    onSuccess: (o) => (qc.setQueryData(["sales-order", id], o), qc.invalidateQueries({ queryKey: ["sales-orders"] }), qc.invalidateQueries({ queryKey: ["jobs"] })),
  });
  const makeJob = useMutation({
    mutationFn: (lineId: string) => api(`/sales-order-lines/${lineId}/jobs`, "POST"),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["sales-order", id] }), qc.invalidateQueries({ queryKey: ["jobs"] })),
  });
  if (so.error) return <ErrorNote error={so.error} />;
  if (!so.data) return <Loading />;
  // The detail endpoint has no order-level due date: it is the earliest line due date.
  const due = so.data.dueDate ?? so.data.lines.map((l) => l.dueDate).filter((x): x is string => !!x).sort()[0] ?? null;
  const d = { ...so.data, dueDate: due };
  const open = d.status === "confirmed" || d.status === "in_production" || d.status === "ready";
  const late = open && isPast(d.dueDate);
  const jobs = d.lines.flatMap((l) => l.jobs);
  const jobsDone = jobs.filter((j) => j.status === "complete" || j.status === "closed").length;
  const ordered = d.lines.reduce((a, l) => a + l.quantity, 0);
  const shipped = d.lines.reduce((a, l) => a + l.quantityShipped, 0);
  const made = d.lines.reduce((a, l) => a + Math.min(l.quantity, l.jobs.reduce((b, j) => b + j.quantityCompleted, 0)), 0);
  const noJob = d.lines.filter((l) => !l.jobs.length).length;
  const daysLeft = d.dueDate ? Math.round((new Date(`${d.dueDate}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000) : null;
  const dates: Record<string, string | undefined> = { confirmed: date(d.orderDate) };
  // Deliveries, newest first, from the order's history.
  const shipments = d.log.filter((e) => e.entity === "sales_order" && e.action === "shipped");
  for (const e of d.log) if (e.entity === "sales_order" && e.action === "status" && typeof e.data.to === "string" && !dates[e.data.to]) dates[e.data.to] = date(e.createdAt);

  return (
    <>
      <DetailTitle
        parent={{ to: "/sales-orders", label: "Sales orders" }}
        title={d.number}
        badge={late ? <Status value="late" /> : <Status value={d.status} text={orderStatusText(d.status)} />}
        actions={
          <>
            {open && ordered > shipped && <Button variant="primary" onClick={() => setShipOpen(true)}><Truck className="h-4 w-4" /> Ship</Button>}
            {d.status === "shipped" && <Button variant="primary" onClick={() => setStatus.mutate("closed")} disabled={setStatus.isPending}>Close order</Button>}
            {shipments.length > 0 && <Button onClick={() => printSlip(d, shipments[0]!)}><Printer className="h-4 w-4" /> Packing slip</Button>}
            {open && shipped === 0 && <MoreMenu items={[{ label: "Cancel order", danger: true, onClick: () => setConfirmCancel(true) }]} />}
          </>
        }
        sub={
          <>
            {d.customerName}
            {d.customerPo && <> · PO {d.customerPo}</>}
            {d.quoteNumber && <> · from <Link className="text-accent hover:underline" to={`/quotes/${d.quoteId}`}>{d.quoteNumber}</Link></>}
          </>
        }
      />
      <ErrorNote error={makeJob.error ?? setStatus.error} />
      {d.status === "ready" && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-ok-soft px-4 py-3 text-sm text-ok ring-1 ring-ok/30">
          <Truck className="h-4 w-4" /> <span className="text-ink">Every job on this order is finished. It is ready to ship.</span>
        </div>
      )}
      <ShipDialog open={shipOpen} order={d} onClose={() => setShipOpen(false)} />
      <Modal open={confirmCancel} title={`Cancel ${d.number}?`} onClose={() => setConfirmCancel(false)}>
        <p className="text-sm">The order is cancelled, and its jobs that have not started are cancelled too. This cannot be undone.</p>
        <ErrorNote error={setStatus.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirmCancel(false)}>Keep the order</Button>
          <Button variant="primary" className="bg-bad" onClick={() => setStatus.mutate("cancelled", { onSuccess: () => setConfirmCancel(false) })} disabled={setStatus.isPending}>Cancel order</Button>
        </div>
      </Modal>

      <div className="mb-5 px-1">
        {d.status === "cancelled" ? (
          <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">This order was cancelled.</div>
        ) : (
          <StageTimeline stages={SO_STAGES} current={d.status} dates={dates} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
        <MetricCard label="Order value" value={money(d.totalPrice)} note={`${d.lines.length} ${d.lines.length === 1 ? "line" : "lines"}`} tone="accent" />
        <MetricCard
          label="Jobs complete"
          value={`${jobsDone} / ${jobs.length}`}
          tone={noJob ? "warn" : "ok"}
          badge={noJob ? <Badge tone="warn">{noJob} without a job</Badge> : undefined}
          note={noJob ? "Create jobs to start production" : "Every line has a job"}
        />
        <MetricCard label="Made" value={`${num(made, 4)} / ${num(ordered, 4)}`} tone="line" note={ordered ? `${Math.round((made / ordered) * 100)}% of the order` : undefined} />
        <MetricCard label="Shipped" value={`${num(shipped, 4)} / ${num(ordered, 4)}`} tone="line" note={ordered ? `${Math.round((shipped / ordered) * 100)}% shipped` : undefined} />
        <MetricCard
          label="Due"
          value={date(d.dueDate)}
          tone={late ? "bad" : daysLeft != null && daysLeft <= 3 && open ? "warn" : "ok"}
          note={!open || daysLeft == null ? "Earliest line due date" : late ? `${-daysLeft} days late` : daysLeft === 0 ? "Due today" : `${daysLeft} days left`}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className={recordCard}>
          <div className="text-[15px] font-medium">{d.customerName}</div>
          <div className="num mt-1 text-[28px] font-semibold leading-tight">{d.number}</div>
          <div className="mt-4 space-y-3">
            <InsetField label="Status" tone={late ? "bad" : open ? "ok" : undefined}>
              <div className="text-[17px] font-medium">{orderStatusText(d.status)}</div>
            </InsetField>
            <div className="grid grid-cols-2 gap-3">
              <InsetField label="Customer PO"><div className="text-[15px]">{d.customerPo ?? "—"}</div></InsetField>
              <InsetField label="From quote">
                {d.quoteNumber ? <Link to={`/quotes/${d.quoteId}`} className="text-[15px] text-accent hover:underline">{d.quoteNumber}</Link> : <div className="text-[15px]">—</div>}
              </InsetField>
              <InsetField label="Ordered"><div className="num text-[15px]">{date(d.orderDate)}</div></InsetField>
              <InsetField label="Due" tone={late ? "bad" : undefined}><div className={cx("num text-[15px]", late && "text-bad")}>{date(d.dueDate)}</div></InsetField>
            </div>
            <InsetField label="Customer">
              <Link to={`/customers/${d.customerId}`} className="text-[15px] text-accent hover:underline">{d.customerName}</Link>
            </InsetField>
            {d.notes && (
              <InsetField label="Notes"><div className="whitespace-pre-wrap text-sm leading-relaxed">{d.notes}</div></InsetField>
            )}
          </div>
        </section>

        <TabPanel
          title="Details"
          tabs={
            <PillTabs
              tabs={[
                { key: "lines" as const, label: "Lines", count: d.lines.length },
                { key: "files" as const, label: "Attachments", count: fileCount },
                { key: "log" as const, label: "Log", count: d.log.length },
              ]}
              value={tab}
              onChange={setTab}
            />
          }
        >
          {tab === "lines" && (
            <div className="space-y-3">
              {d.lines.map((l) => (
                <OrderLine key={l.id} l={l} onMakeJob={() => makeJob.mutate(l.id)} busy={makeJob.isPending} />
              ))}
              <div className="flex justify-end gap-4 pt-1 text-sm">
                <span className="text-muted">Order total</span>
                <span className="num font-semibold">{money(d.totalPrice)}</span>
              </div>
            </div>
          )}
          {tab === "files" && <FilesPanel entity="sales_order" entityId={d.id} onCount={setFileCount} height={440} />}
          {tab === "log" && (
            <ol className="space-y-3">
              {d.log.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
                  <div>
                    <div>{logText(e)}</div>
                    <div className="text-xs text-muted">
                      {new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      {e.userName && ` · ${e.userName}`}
                    </div>
                  </div>
                </li>
              ))}
              {!d.log.length && <li className="py-8 text-center text-sm text-muted">Nothing recorded yet.</li>}
            </ol>
          )}
        </TabPanel>
      </div>
    </>
  );
}

const SO_STAGES = [
  { key: "confirmed", label: "Confirmed" },
  { key: "in_production", label: "In production" },
  { key: "ready", label: "Ready to ship" },
  { key: "shipped", label: "Shipped" },
  { key: "closed", label: "Closed" },
];

function logText(e: SalesOrderDetail["log"][number]) {
  const d = e.data;
  if (e.entity === "job") return e.action === "created" ? `Job ${e.jobNumber} created` : `Job ${e.jobNumber}: ${label(String(d.from))} → ${label(String(d.to))}`;
  if (e.action === "created") return d.fromQuote ? `Order created from quote ${d.fromQuote}` : "Order created";
  if (e.action === "shipped") return `Shipped ${(d.lines as { lineNo: number; quantity: number }[]).map((l) => `${num(l.quantity, 4)} on line ${l.lineNo}`).join(", ")}${d.note ? ` (${d.note})` : ""}`;
  if (e.action === "status") return d.auto ? `${orderStatusText(String(d.to))} (all jobs finished)` : `Order ${orderStatusText(String(d.from)).toLowerCase()} → ${orderStatusText(String(d.to)).toLowerCase()}`;
  if (e.action === "file_added") return `Added file ${d.file}`;
  if (e.action === "file_removed") return `Removed file ${d.file}`;
  return label(e.action);
}

/** One order line as a part card: thumbnail, part, quantity tiles and its jobs. */
function OrderLine({ l, onMakeJob, busy }: { l: SalesOrderDetail["lines"][number]; onMakeJob: () => void; busy: boolean }) {
  const files = useQuery({ queryKey: ["files", "item", l.itemId], queryFn: () => api<FileRow[]>(`/files?entity=item&entityId=${l.itemId}`), enabled: !!l.itemId });
  const thumb = useThumb((files.data ?? []).find((f) => f.kind === "cad" || f.kind === "mesh")?.id);
  const custom = !!l.partNumber && /^Q-\d+-\d+$/.test(l.partNumber);
  const late = l.quantityShipped < l.quantity && isPast(l.dueDate);
  return (
    <div className="rounded-xl ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-4 p-3">
        <div className="flex h-20 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-panel-2">
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <Box className="h-7 w-7 text-muted" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">Line {l.lineNo}</div>
          {l.itemId ? (
            <Link to={`/items/${l.itemId}`} className="num block truncate text-[17px] font-semibold hover:text-accent hover:underline">{l.partNumber}{l.revision && <span className="font-normal text-muted"> rev {l.revision}</span>}</Link>
          ) : null}
          <div className={cx("truncate", l.itemId ? "text-muted" : "text-[17px] font-semibold")}>{l.description}</div>
          <span className={cx("mt-1 inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium", custom || !l.itemId ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent")}>{custom || !l.itemId ? "Custom" : "Catalogue part"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Quantity", num(l.quantity, 4)],
            ["Unit price", money(l.unitPrice)],
            ["Total", money(l.unitPrice * l.quantity)],
            ["Due", date(l.dueDate)],
          ].map(([k, v]) => (
            <div key={k} className={cx("min-w-24 rounded-lg px-3 py-2 text-center", k === "Due" && late ? "bg-bad-soft text-bad" : "bg-panel-2")}>
              <div className="text-xs text-muted">{k}</div>
              <div className="num mt-0.5 font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2.5">
        {l.jobs.length ? (
          l.jobs.map((j) => {
            const pct = j.quantity ? Math.min(100, Math.round((j.quantityCompleted / j.quantity) * 100)) : 0;
            return (
              <Link key={j.id} to={`/jobs/${j.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-panel-2">
                <span className="num font-medium">{j.number}</span>
                <Status value={j.status} />
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-2">
                  <span className={cx("block h-full", j.status === "in_progress" ? "bg-live" : "bg-ok")} style={{ width: `${pct}%` }} />
                </span>
                <span className="num text-xs text-muted">{num(j.quantityCompleted, 4)} / {num(j.quantity, 4)} made</span>
              </Link>
            );
          })
        ) : (
          <>
            <span className="text-sm text-warn">No job yet</span>
            <Button onClick={onMakeJob} disabled={busy}>Create job</Button>
          </>
        )}
        <span className="num ml-auto text-xs text-muted">{num(l.quantityShipped, 4)} shipped</span>
      </div>
    </div>
  );
}

/** An order's status in words ("ready" means ready to ship). */
export const orderStatusText = (s: string) => (s === "ready" ? "Ready to ship" : label(s));

/** Record a delivery: how many of each line go out now (what is left, by default). */
function ShipDialog({ open, order, onClose }: { open: boolean; order: SalesOrderDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const left = (l: SalesOrderDetail["lines"][number]) => Math.max(0, Math.round((l.quantity - l.quantityShipped) * 10000) / 10000);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) (setQty(Object.fromEntries(order.lines.map((l) => [l.id, String(left(l))]))), setNote(""));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ship = useMutation({
    mutationFn: () =>
      api<SalesOrderDetail>(`/sales-orders/${order.id}/ship`, "POST", {
        lines: order.lines.map((l) => ({ lineId: l.id, quantity: Number(qty[l.id] || 0) })).filter((x) => x.quantity > 0),
        note: note.trim() || null,
      }),
    onSuccess: (o) => {
      qc.setQueryData(["sales-order", order.id], o);
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
      const last = o.log.find((e) => e.entity === "sales_order" && e.action === "shipped");
      if (last) printSlip(o, last);
      onClose();
    },
  });
  const any = order.lines.some((l) => Number(qty[l.id] || 0) > 0);
  return (
    <Modal open={open} title={`Ship ${order.number}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), ship.mutate())}>
        <p className="text-sm text-muted">Enter how many of each line go out now. A packing slip opens to print when you ship.</p>
        <Table head={["Line", R("Ordered"), R("Shipped"), R("Ship now")]}>
          {order.lines.map((l) => (
            <tr key={l.id}>
              <Td><span className="font-medium">{l.partNumber ?? `Line ${l.lineNo}`}</span><div className="max-w-56 truncate text-xs text-muted">{l.description}</div></Td>
              <Td right>{num(l.quantity, 4)}</Td>
              <Td right>{num(l.quantityShipped, 4)}</Td>
              <Td right>
                <input type="number" min={0} max={left(l)} step="any" aria-label={`Ship now, line ${l.lineNo}`} value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} disabled={left(l) <= 0} className="num w-24 rounded-md bg-panel-2 px-2 py-1 text-right ring-1 ring-line" />
              </Td>
            </tr>
          ))}
        </Table>
        <label className="block text-sm">
          <span className="mb-1 block text-[13px] font-medium text-muted">Note (carrier, tracking number…)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full rounded-lg bg-panel-2 px-3 py-2 ring-1 ring-line" />
        </label>
        <ErrorNote error={ship.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!any || ship.isPending}><Truck className="h-4 w-4" /> {ship.isPending ? "Shipping…" : "Ship"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** A printable packing slip for one delivery. */
function printSlip(o: SalesOrderDetail, shipment: SalesOrderDetail["log"][number]) {
  const w = window.open("", "_blank", "width=900,height=900");
  if (!w) return;
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const sent = (shipment.data.lines as { lineNo: number; quantity: number }[]) ?? [];
  const rows = sent
    .map((s) => {
      const l = o.lines.find((x) => x.lineNo === s.lineNo);
      return `<tr><td>${s.lineNo}</td><td>${esc(l?.partNumber ?? "")}${l?.revision ? ` rev ${esc(l.revision)}` : ""}</td><td>${esc(l?.description ?? "")}</td><td class="r">${esc(num(l?.quantity ?? 0, 4))}</td><td class="r"><b>${esc(num(s.quantity, 4))}</b></td><td class="r">${esc(num(Math.max(0, (l?.quantity ?? 0) - (l?.quantityShipped ?? 0)), 4))}</td></tr>`;
    })
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Packing slip ${esc(o.number)}</title>
<style>@page{size:A4;margin:14mm}body{font:12px system-ui,sans-serif;color:#111}h1{font-size:22px;margin:0}.m{color:#555}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ccc;padding:6px;text-align:left}th{font-size:11px;color:#555}.r{text-align:right}.g{display:flex;justify-content:space-between;gap:24px;margin-top:14px}.sig{margin-top:48px;display:flex;gap:40px}.sig div{flex:1;border-top:1px solid #999;padding-top:4px;color:#555}</style></head><body>
<h1>Packing slip</h1><div class="m">Order ${esc(o.number)}${o.customerPo ? ` · Your PO ${esc(o.customerPo)}` : ""} · Shipped ${esc(new Date(shipment.createdAt).toLocaleDateString())}</div>
<div class="g"><div><b>Ship to</b><br>${esc(o.customerName)}</div><div>${shipment.data.note ? `<b>Note</b><br>${esc(shipment.data.note)}` : ""}</div></div>
<table><thead><tr><th>#</th><th>Part</th><th>Description</th><th class="r">Ordered</th><th class="r">This delivery</th><th class="r">Still to come</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sig"><div>Packed by</div><div>Received by</div></div></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
