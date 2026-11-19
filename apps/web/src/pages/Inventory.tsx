/**
 * Inventory: what is on the shelves, where, in which lots, what open jobs need, and every
 * movement. Also receiving stock, locations and the spreadsheet stock take.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ClipboardList, Download, FileCheck2, MapPin, PackagePlus, Scissors, Upload } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError, qs, type Item, type ItemStock, type StockLocation, type StockLot, type StockRow } from "../api.ts";
import { fileUrl } from "../components/Files.tsx";
import { Badge, Button, cx, DetailTitle, ErrorNote, Field, Input, ListBar, Loading, MetricCard, Modal, PageHeader, R, SearchBox, Select, Status, Table, TabPanel, Td, ViewTabs } from "../components/ui.tsx";
import { date, money, num } from "../format.ts";

const q4 = (n: number) => num(n, Number.isInteger(n) ? 0 : 2);
const TYPE_LABEL: Record<string, string> = { material: "Material", purchased: "Bought", manufactured: "Made", service: "Service" };

const KIND: Record<string, { label: string; tone: "ok" | "bad" | "warn" | "accent" | "muted" }> = {
  receive: { label: "Received", tone: "ok" },
  consume: { label: "Picked for job", tone: "bad" },
  return: { label: "Returned from job", tone: "ok" },
  remnant: { label: "Remnant saved", tone: "accent" },
  adjust: { label: "Adjusted", tone: "warn" },
  count: { label: "Stock take", tone: "warn" },
  move_out: { label: "Moved out", tone: "muted" },
  move_in: { label: "Moved in", tone: "muted" },
};

// ── Overview ────────────────────────────────────────────────────────────────

export function InventoryPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [view, setView] = useState("all");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const list = useQuery({ queryKey: ["inventory", q], queryFn: () => api<StockRow[]>(`/inventory${qs({ q })}`) });
  const rows = list.data ?? [];
  const low = (r: StockRow) => r.reorderPoint != null && r.onHand <= r.reorderPoint;
  const short = (r: StockRow) => r.available < 0;
  const shown = rows.filter((r) => (view === "low" ? low(r) : view === "short" ? short(r) : view === "remnants" ? r.remnants > 0 : view === "stocked" ? r.onHand > 0 : true));
  const value = rows.reduce((a, r) => a + r.value, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        sub="Stock on hand by lot and location, what open jobs still need, and every movement."
        actions={
          <>
            <Button onClick={() => setLocOpen(true)}>
              <MapPin className="h-4 w-4" /> Locations
            </Button>
            <Button onClick={() => nav("/inventory/stock-take")}>
              <ClipboardList className="h-4 w-4" /> Stock take
            </Button>
            <Button variant="primary" onClick={() => setReceiveOpen(true)}>
              <PackagePlus className="h-4 w-4" /> Receive stock
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Stock value" value={money(value, 0)} note={`${rows.filter((r) => r.onHand > 0).length} items in stock`} tone="accent" />
        <MetricCard label="Short for open jobs" value={rows.filter(short).length} note="Needed by jobs is more than on hand" tone={rows.some(short) ? "bad" : "ok"} />
        <MetricCard label="At or below reorder point" value={rows.filter(low).length} note="Time to buy" tone={rows.some(low) ? "warn" : "ok"} />
        <MetricCard label="Remnants on the shelf" value={rows.reduce((a, r) => a + r.remnants, 0)} note="Off-cuts saved from jobs" tone="line" />
      </div>

      <section className="rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
        <ListBar>
          <ViewTabs
            views={[
              { key: "all", label: "All" },
              { key: "stocked", label: "In stock" },
              { key: "short", label: "Short for jobs" },
              { key: "low", label: "Reorder" },
              { key: "remnants", label: "Remnants" },
            ]}
            value={view}
            onChange={setView}
          />
          <div className="ml-auto w-full sm:w-72">
            <SearchBox value={q} onChange={setQ} placeholder="Search part number or description" />
          </div>
        </ListBar>
        {list.error && <ErrorNote error={list.error} />}
        {list.isLoading ? (
          <Loading />
        ) : (
          <Table head={["Item", "Type", R("On hand"), R("On order"), R("Needed by jobs"), R("Available"), R("Reorder at"), R("Value"), "Lots"]} empty="Nothing here. Receive stock to start tracking it.">
            {shown.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-panel-2/60" onClick={() => nav(`/inventory/${r.id}`)}>
                <Td>
                  <div className="font-medium">{r.partNumber}</div>
                  <div className="max-w-80 truncate text-xs text-muted">{r.description}</div>
                </Td>
                <Td>
                  <Badge tone={r.type === "material" ? "warn" : "accent"}>{TYPE_LABEL[r.type] ?? r.type}</Badge>
                </Td>
                <Td right className="font-medium">
                  {q4(r.onHand)} <span className="text-xs font-normal text-muted">{r.uom}</span>
                </Td>
                <Td right className={r.onOrder ? "text-ok" : "text-muted"}>{r.onOrder ? `+${q4(r.onOrder)}` : "—"}</Td>
                <Td right className="text-muted">{r.needed ? q4(r.needed) : "—"}</Td>
                <Td right className={cx("font-medium", r.available < 0 ? "text-bad" : "text-ok")}>
                  <span className="inline-flex items-center gap-1">
                    {r.needed > 0 && (r.available < 0 ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />)}
                    {q4(r.available)}
                  </span>
                </Td>
                <Td right className={low(r) ? "font-medium text-warn" : "text-muted"}>{r.reorderPoint != null ? q4(r.reorderPoint) : "—"}</Td>
                <Td right>{money(r.value)}</Td>
                <Td>
                  <span className="flex items-center gap-1.5">
                    <span className="num">{r.lots}</span>
                    {r.remnants > 0 && (
                      <Badge tone="accent">
                        <Scissors className="h-3 w-3" /> {r.remnants}
                      </Badge>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </section>
      <ReceiveModal open={receiveOpen} onClose={() => setReceiveOpen(false)} />
      <LocationsModal open={locOpen} onClose={() => setLocOpen(false)} />
    </div>
  );
}

// ── Receive ─────────────────────────────────────────────────────────────────

async function uploadTo(entity: string, entityId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`/api/v1/files?entity=${entity}&entityId=${entityId}`, { method: "POST", body, credentials: "same-origin" });
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new ApiError(res.status, d?.error?.message ?? `Upload failed (${res.status})`);
  }
}

export function ReceiveModal({ open, onClose, itemId }: { open: boolean; onClose: () => void; itemId?: string }) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["items", "", ""], queryFn: () => api<Item[]>("/items"), enabled: open });
  const locs = useQuery({ queryKey: ["stock-locations"], queryFn: () => api<StockLocation[]>("/inventory/locations"), enabled: open });
  const blank = { itemId: itemId ?? "", quantity: "", unitCost: "", locationId: "", dimensions: "", heatNumber: "", supplier: "", note: "" };
  const [f, setF] = useState(blank);
  const [cert, setCert] = useState<File | null>(null);
  const item = items.data?.find((i) => i.id === (itemId ?? f.itemId));
  const save = useMutation({
    mutationFn: async () => {
      const lot = await api<{ id: string; lotNumber: string }>("/inventory/receive", "POST", {
        itemId: itemId ?? f.itemId,
        quantity: Number(f.quantity),
        unitCost: f.unitCost === "" ? (item?.unitCost ?? 0) : Number(f.unitCost),
        locationId: f.locationId || null,
        dimensions: f.dimensions || null,
        heatNumber: f.heatNumber || null,
        supplier: f.supplier || null,
        note: f.note || null,
      });
      if (cert) await uploadTo("stock_lot", lot.id, cert);
      return lot;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["item-stock"] });
      qc.invalidateQueries({ queryKey: ["stock-locations"] });
      setF(blank);
      setCert(null);
      onClose();
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const stockable = (items.data ?? []).filter((i) => i.active && i.type !== "service");
  return (
    <Modal open={open} onClose={onClose} title="Receive stock">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {!itemId && (
          <Field label="Item">
            <Select value={f.itemId} onChange={set("itemId")} required>
              <option value="">Choose a material or part…</option>
              {stockable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.partNumber} — {i.description}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Quantity${item ? ` (${item.uom})` : ""}`}>
            <Input type="number" min={0} step="any" value={f.quantity} onChange={set("quantity")} required />
          </Field>
          <Field label="Unit cost" hint={item ? `Blank uses the part's ${money(item.unitCost)}` : undefined}>
            <Input type="number" min={0} step="any" value={f.unitCost} onChange={set("unitCost")} placeholder={item ? String(item.unitCost) : ""} />
          </Field>
          <Field label="Location">
            <Select value={f.locationId} onChange={set("locationId")}>
              <option value="">{locs.data?.length ? "Where it usually goes" : "MAIN (made for you)"}</option>
              {(locs.data ?? []).filter((l) => l.active).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                  {l.name ? ` — ${l.name}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Size (optional)" hint="e.g. 48 x 96, 12 ft">
            <Input value={f.dimensions} onChange={set("dimensions")} />
          </Field>
          <Field label="Heat or mill lot (optional)">
            <Input value={f.heatNumber} onChange={set("heatNumber")} />
          </Field>
          <Field label="Supplier (optional)">
            <Input value={f.supplier} onChange={set("supplier")} />
          </Field>
        </div>
        <Field label="Material certificate (optional)" hint="PDF or photo; kept with the lot and any remnants cut from it">
          <input key={cert ? "picked" : "empty"} type="file" accept=".pdf,image/*" onChange={(e) => setCert(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        </Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? "Receiving…" : "Receive into a new lot"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Locations ───────────────────────────────────────────────────────────────

function LocationsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const locs = useQuery({ queryKey: ["stock-locations"], queryFn: () => api<StockLocation[]>("/inventory/locations"), enabled: open });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => api("/inventory/locations", "POST", { code, name: name || null }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["stock-locations"] }), setCode(""), setName("")),
  });
  const toggle = useMutation({
    mutationFn: (l: StockLocation) => api(`/inventory/locations/${l.id}`, "PUT", { code: l.code, name: l.name, active: !l.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stock-locations"] }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Stock locations">
      <div className="space-y-3">
        <Table head={["Code", "Name", R("Lots"), R("Value"), ""]} empty="No locations yet. The first receipt makes MAIN for you.">
          {(locs.data ?? []).map((l) => (
            <tr key={l.id} className={cx(!l.active && "opacity-50")}>
              <Td className="font-medium">{l.code}</Td>
              <Td className="text-muted">{l.name ?? "—"}</Td>
              <Td right>{l.lots}</Td>
              <Td right>{money(l.value, 0)}</Td>
              <Td right>
                <button type="button" className="text-sm text-accent hover:underline" onClick={() => toggle.mutate(l)}>
                  {l.active ? "Retire" : "Use again"}
                </button>
              </Td>
            </tr>
          ))}
        </Table>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="RACK-A2" required className="w-32" />
          </Field>
          <div className="flex-1">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bar rack, bay 2" />
            </Field>
          </div>
          <Button type="submit" variant="primary" disabled={add.isPending}>
            Add
          </Button>
        </form>
        <ErrorNote error={add.error ?? toggle.error} />
      </div>
    </Modal>
  );
}

// ── One item ────────────────────────────────────────────────────────────────

export function ItemStockPage() {
  const { id = "" } = useParams();
  const s = useQuery({ queryKey: ["item-stock", id], queryFn: () => api<ItemStock>(`/inventory/items/${id}`) });
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [tab, setTab] = useState("lots");
  if (s.error) return <ErrorNote error={s.error} />;
  if (!s.data) return <Loading />;
  const d = s.data;
  const low = d.item.reorderPoint != null && d.onHand <= d.item.reorderPoint;
  return (
    <div className="space-y-5">
      <DetailTitle
        parent={{ to: "/inventory", label: "Inventory" }}
        title={d.item.partNumber}
        badge={<Badge tone={d.item.type === "material" ? "warn" : "accent"}>{TYPE_LABEL[d.item.type] ?? d.item.type}</Badge>}
        sub={
          <>
            {d.item.description} ·{" "}
            <Link to={`/items/${d.item.id}`} className="text-accent hover:underline">
              Open the part
            </Link>
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setReceiveOpen(true)}>
            <PackagePlus className="h-4 w-4" /> Receive
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="On hand" value={`${q4(d.onHand)} ${d.item.uom}`} note={`${d.lots.filter((l) => l.quantity > 0).length} lots`} tone="accent" />
        <MetricCard label="Needed by open jobs" value={q4(d.needed)} note={`${d.demand.filter((x) => x.remaining > 0).length} jobs`} tone="line" />
        <MetricCard label="Available" value={q4(d.available)} note={d.available < 0 ? "Short: buy or move stock" : "After open jobs"} tone={d.available < 0 ? "bad" : "ok"} />
        <MetricCard label="Value" value={money(d.value)} note="At each lot's cost" tone="line" />
        <ReorderCard d={d} low={low} />
      </div>

      <TabPanel
        title="Stock"
        tabs={
          <ViewTabs
            views={[
              { key: "lots", label: `Lots (${d.lots.filter((l) => l.quantity > 0).length})` },
              { key: "ledger", label: "Transactions" },
              { key: "demand", label: "Open jobs" },
              { key: "certs", label: "Certificates" },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
      >
        {tab === "lots" && <LotsTable d={d} />}
        {tab === "ledger" && <Ledger d={d} />}
        {tab === "demand" && (
          <Table head={["Job", "Status", "Due", R("Required"), R("Picked"), R("Still needed")]} empty="No open job needs this item.">
            {d.demand.map((x) => (
              <tr key={x.jobId}>
                <Td>
                  <Link to={`/jobs/${x.jobId}`} className="font-medium text-accent hover:underline">
                    {x.jobNumber}
                  </Link>
                </Td>
                <Td>
                  <Status value={x.status} />
                </Td>
                <Td>{date(x.dueDate)}</Td>
                <Td right>{q4(x.required)}</Td>
                <Td right>{q4(x.issued)}</Td>
                <Td right className={x.remaining > 0 ? "font-medium" : "text-muted"}>{q4(x.remaining)}</Td>
              </tr>
            ))}
          </Table>
        )}
        {tab === "certs" && <Certificates d={d} />}
      </TabPanel>
      <ReceiveModal open={receiveOpen} onClose={() => setReceiveOpen(false)} itemId={d.item.id} />
    </div>
  );
}

function ReorderCard({ d, low }: { d: ItemStock; low: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [pt, setPt] = useState(d.item.reorderPoint == null ? "" : String(d.item.reorderPoint));
  const [qty, setQty] = useState(d.item.reorderQuantity == null ? "" : String(d.item.reorderQuantity));
  const save = useMutation({
    mutationFn: () => api<ItemStock>(`/inventory/items/${d.item.id}/reorder`, "PUT", { reorderPoint: pt === "" ? null : Number(pt), reorderQuantity: qty === "" ? null : Number(qty) }),
    onSuccess: (data) => (qc.setQueryData(["item-stock", d.item.id], data), qc.invalidateQueries({ queryKey: ["inventory"] }), setEdit(false)),
  });
  if (!edit)
    return (
      <button type="button" onClick={() => setEdit(true)} className="text-left">
        <MetricCard
          label="Reorder point"
          value={d.item.reorderPoint == null ? "Not set" : q4(d.item.reorderPoint)}
          note={d.item.reorderPoint == null ? "Click to set" : low ? `Reorder ${d.item.reorderQuantity != null ? q4(d.item.reorderQuantity) : "now"}` : `Order ${d.item.reorderQuantity != null ? q4(d.item.reorderQuantity) : "—"} when reached`}
          tone={low ? "warn" : "line"}
        />
      </button>
    );
  return (
    <div className="rounded-xl bg-panel px-4 py-3 shadow-panel ring-2 ring-accent">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Reorder at
          <Input type="number" min={0} step="any" value={pt} onChange={(e) => setPt(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Order qty
          <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setEdit(false)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Save
        </Button>
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}

function LotsTable({ d }: { d: ItemStock }) {
  const qc = useQueryClient();
  const locs = useQuery({ queryKey: ["stock-locations"], queryFn: () => api<StockLocation[]>("/inventory/locations") });
  const [empty, setEmpty] = useState(false);
  const [act, setAct] = useState<{ lot: StockLot; mode: "adjust" | "move" | "cert" } | null>(null);
  const done = () => (qc.invalidateQueries({ queryKey: ["item-stock", d.item.id] }), qc.invalidateQueries({ queryKey: ["inventory"] }), setAct(null));
  const lots = d.lots.filter((l) => empty || l.quantity > 0);
  return (
    <div className="space-y-2">
      <Table head={["Lot", "Location", "Size", "Heat / supplier", R("Quantity"), R("Unit cost"), R("Value"), "Received", "Cert", ""]} empty="No stock. Receive some to create the first lot.">
        {lots.map((l) => (
          <tr key={l.id} className={cx(l.quantity === 0 && "text-muted")}>
            <Td>
              <div className="num font-medium">{l.lotNumber}</div>
              {l.remnant && (
                <Badge tone="accent">
                  <Scissors className="h-3 w-3" /> Remnant
                </Badge>
              )}
            </Td>
            <Td>{l.location}</Td>
            <Td>{l.dimensions ?? "—"}</Td>
            <Td className="text-muted">
              <div>{l.heatNumber ?? "—"}</div>
              <div className="text-xs">{l.supplier ?? ""}</div>
            </Td>
            <Td right className="font-medium">
              {q4(l.quantity)} <span className="text-xs font-normal text-muted">{d.item.uom}</span>
            </Td>
            <Td right>{money(l.unitCost, 4)}</Td>
            <Td right>{money(l.quantity * l.unitCost)}</Td>
            <Td className="text-muted">{date(l.receivedAt)}</Td>
            <Td>
              {l.certs.length ? (
                l.certs.map((c) => (
                  <a key={c.id} href={fileUrl(c.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-accent hover:underline" title={c.inherited ? "From the parent lot" : c.fileName}>
                    <FileCheck2 className="h-4 w-4" /> {c.inherited ? "Parent's" : "View"}
                  </a>
                ))
              ) : (
                <button type="button" className="text-sm text-muted hover:text-accent" onClick={() => setAct({ lot: l, mode: "cert" })}>
                  Add
                </button>
              )}
            </Td>
            <Td right>
              <span className="flex justify-end gap-3 text-sm">
                <button type="button" className="text-accent hover:underline" onClick={() => setAct({ lot: l, mode: "move" })}>
                  Move
                </button>
                <button type="button" className="text-accent hover:underline" onClick={() => setAct({ lot: l, mode: "adjust" })}>
                  Adjust
                </button>
              </span>
            </Td>
          </tr>
        ))}
      </Table>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Show used-up lots
      </label>
      {act && <LotAction act={act} uom={d.item.uom} locations={locs.data ?? []} onClose={() => setAct(null)} onDone={done} />}
    </div>
  );
}

function LotAction({ act, uom, locations, onClose, onDone }: { act: { lot: StockLot; mode: "adjust" | "move" | "cert" }; uom: string; locations: StockLocation[]; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(String(act.lot.quantity));
  const [note, setNote] = useState("");
  const [loc, setLoc] = useState(act.lot.locationId);
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (act.mode === "adjust") return api(`/inventory/lots/${act.lot.id}/adjust`, "POST", { quantity: Number(qty), note });
      if (act.mode === "move") return api(`/inventory/lots/${act.lot.id}/move`, "POST", { locationId: loc });
      if (file) return uploadTo("stock_lot", act.lot.id, file);
    },
    onSuccess: onDone,
  });
  const title = act.mode === "adjust" ? `Adjust lot ${act.lot.lotNumber}` : act.mode === "move" ? `Move lot ${act.lot.lotNumber}` : `Certificate for lot ${act.lot.lotNumber}`;
  return (
    <Modal open onClose={onClose} title={title}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {act.mode === "adjust" && (
          <>
            <Field label={`Quantity now (${uom})`} hint={`Was ${q4(act.lot.quantity)}`}>
              <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} required />
            </Field>
            <Field label="Reason">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Damaged end cut off, found in wrong rack" required />
            </Field>
          </>
        )}
        {act.mode === "move" && (
          <Field label="Move the whole lot to">
            <Select value={loc} onChange={(e) => setLoc(e.target.value)}>
              {locations
                .filter((l) => l.active)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}
                    {l.name ? ` — ${l.name}` : ""}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {act.mode === "cert" && (
          <Field label="Mill or material certificate" hint="Remnants cut from this lot show it too">
            <input type="file" accept=".pdf,image/*" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
          </Field>
        )}
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {act.mode === "adjust" ? "Save quantity" : act.mode === "move" ? "Move lot" : "Upload certificate"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Ledger({ d }: { d: ItemStock }) {
  const [q, setQ] = useState("");
  const rows = d.ledger.filter((t) => !q || [t.lotNumber, t.jobNumber, t.location, t.dimensions, t.note, t.userName, KIND[t.kind]?.label].some((v) => v?.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-2">
      <div className="w-full sm:w-80">
        <SearchBox value={q} onChange={setQ} placeholder="Search lot, job, location, person" />
      </div>
      <Table head={["What", "Lot / location", "Size", R("Change"), R("Value change"), "By", "When"]} empty="No movements yet.">
        {rows.map((t) => {
          const k = KIND[t.kind] ?? { label: t.kind, tone: "muted" as const };
          return (
            <tr key={t.id}>
              <Td>
                <div className="font-medium">{k.label}</div>
                <div className="text-xs text-muted">
                  {t.jobId ? (
                    <Link to={`/jobs/${t.jobId}`} className="text-accent hover:underline">
                      {t.jobNumber}
                    </Link>
                  ) : (
                    (t.note ?? "")
                  )}
                  {t.jobId && t.note ? ` · ${t.note}` : ""}
                </div>
              </Td>
              <Td>
                <div className="num">{t.lotNumber ?? <span className="text-muted">Untracked</span>}</div>
                <div className="text-xs text-muted">{t.location ?? ""}</div>
              </Td>
              <Td className="text-muted">{t.dimensions ?? "—"}</Td>
              {t.lotId ? (
                <>
                  <Td right>
                    <span className={cx("num inline-flex items-center gap-1 font-medium", t.quantity > 0 ? "text-ok" : t.quantity < 0 ? "text-bad" : "text-muted")}>
                      {t.quantity > 0 ? <ArrowUp className="h-3.5 w-3.5" /> : t.quantity < 0 ? <ArrowDown className="h-3.5 w-3.5" /> : null}
                      {q4(Math.abs(t.quantity))}
                    </span>
                  </Td>
                  <Td right className={cx("num", t.value > 0 ? "text-ok" : t.value < 0 ? "text-bad" : "text-muted")}>
                    {t.value === 0 ? "—" : `${t.value > 0 ? "+" : "−"}${money(Math.abs(t.value))}`}
                  </Td>
                </>
              ) : (
                // Untracked picks and returns are recorded for the job but did not move shelf stock.
                <Td right className="text-muted" colSpan={2}>
                  <span className="num">{q4(Math.abs(t.quantity))}</span> <span className="text-xs">not from stock</span>
                </Td>
              )}
              <Td className="text-muted">{t.userName ?? "—"}</Td>
              <Td className="whitespace-nowrap text-muted">{new Date(t.createdAt).toLocaleString()}</Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

function Certificates({ d }: { d: ItemStock }) {
  const lots = d.lots.filter((l) => l.certs.length || l.usedOn.length);
  return (
    <Table head={["Lot", "Heat", "Certificate", "Used on jobs"]} empty="No certificates yet. Add one when receiving, or from the Lots tab.">
      {lots.map((l) => (
        <tr key={l.id}>
          <Td className="num font-medium">{l.lotNumber}</Td>
          <Td className="text-muted">{l.heatNumber ?? "—"}</Td>
          <Td>
            {l.certs.length ? (
              l.certs.map((c) => (
                <a key={c.id} href={fileUrl(c.id, true)} className="flex items-center gap-1 text-accent hover:underline">
                  <Download className="h-4 w-4" /> {c.fileName}
                  {c.inherited && <span className="text-xs text-muted">(parent lot)</span>}
                </a>
              ))
            ) : (
              <span className="text-warn">Missing</span>
            )}
          </Td>
          <Td>
            {l.usedOn.length ? (
              <span className="flex flex-wrap gap-2">
                {l.usedOn.map((u) => (
                  <Link key={u.jobId} to={`/jobs/${u.jobId}`} className="text-accent hover:underline">
                    {u.jobNumber} <span className="text-xs text-muted">({q4(u.quantity)})</span>
                  </Link>
                ))}
              </span>
            ) : (
              <span className="text-muted">Not used yet</span>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

// ── Stock take ──────────────────────────────────────────────────────────────

type SheetRow = { lotId: string; partNumber: string; description: string; uom: string; location: string; lotNumber: string; dimensions: string | null; quantity: number; unitCost: number };
type Preview = { checked: number; changes: { lotId: string; lotNumber: string; partNumber: string; before: number; counted: number; delta: number; value: number; movedSinceDownload: boolean }[]; valueChange: number; applied: boolean };

const HEAD = ["Lot ID (do not change)", "Part number", "Description", "Unit", "Location", "Lot", "Size", "Quantity on sheet", "Counted quantity"];

function toCsv(rows: SheetRow[]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [HEAD, ...rows.map((r) => [r.lotId, r.partNumber, r.description, r.uom, r.location, r.lotNumber, r.dimensions ?? "", r.quantity, ""])].map((r) => r.map(esc).join(",")).join("\n");
}

/** Small CSV reader (quoted fields, commas and newlines inside quotes). */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

function Step({ n, title, active, children }: { n: number; title: string; active: boolean; children: ReactNode }) {
  return (
    <section className={cx("flex gap-4 rounded-xl bg-panel p-5 shadow-panel ring-1", active ? "ring-accent" : "ring-line/70 opacity-70")}>
      <span className={cx("num flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold", active ? "bg-accent text-white" : "bg-panel-2 text-muted")}>{n}</span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-1.5">{children}</div>
      </div>
    </section>
  );
}

export function StockTakePage() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [rows, setRows] = useState<{ lotId: string; counted: number; expected: number }[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const check = useMutation({ mutationFn: (r: NonNullable<typeof rows>) => api<Preview>("/inventory/stock-take", "POST", { rows: r }), onSuccess: setPreview });
  const apply = useMutation({
    mutationFn: () => api<Preview>("/inventory/stock-take", "POST", { rows, apply: true }),
    onSuccess: (p) => (setPreview(p), qc.invalidateQueries({ queryKey: ["inventory"] }), qc.invalidateQueries({ queryKey: ["item-stock"] })),
  });

  const download = async () => {
    const data = await api<SheetRow[]>("/inventory/stock-take");
    const blob = new Blob([toCsv(data)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock-take-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDownloaded(true);
  };

  const read = async (file: File) => {
    setProblem(null);
    setPreview(null);
    const grid = parseCsv(await file.text());
    const head = grid[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    const iId = head.findIndex((h) => h.startsWith("lot id"));
    const iExp = head.findIndex((h) => h.startsWith("quantity on sheet"));
    const iCnt = head.findIndex((h) => h.startsWith("counted"));
    if (iId < 0 || iExp < 0 || iCnt < 0) return setProblem("This is not a stock-take sheet from Ironline. Download the sheet in step 1 and fill in the Counted quantity column.");
    const out: { lotId: string; counted: number; expected: number }[] = [];
    const bad: number[] = [];
    grid.slice(1).forEach((r, i) => {
      const c = (r[iCnt] ?? "").trim();
      if (!c) return; // Blank count: lot not counted, left as it is.
      const n = Number(c);
      if (!Number.isFinite(n) || n < 0) bad.push(i + 2);
      else out.push({ lotId: (r[iId] ?? "").trim(), counted: n, expected: Number(r[iExp] ?? 0) });
    });
    if (bad.length) return setProblem(`Row${bad.length > 1 ? "s" : ""} ${bad.slice(0, 8).join(", ")} ha${bad.length > 1 ? "ve" : "s"} a counted quantity that is not a number of 0 or more.`);
    if (!out.length) return setProblem("No counted quantities found. Fill in the Counted quantity column for the lots you counted.");
    setRows(out);
    check.mutate(out);
  };

  const flagged = preview?.changes.filter((c) => c.movedSinceDownload).length ?? 0;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <DetailTitle parent={{ to: "/inventory", label: "Inventory" }} title="Stock take" sub="Count what is on the shelves in a spreadsheet, then load the counts back in." />
      <Step n={1} title="Download the stock sheet" active={!rows}>
        <p className="text-sm text-muted">One row per lot with stock (CSV, opens in Excel, Numbers or Google Sheets). Fill in "Counted quantity" for the lots you count; leave it blank to keep a lot as it is. Keep the Lot ID column as it is.</p>
        <Button className="mt-3" variant={downloaded ? "secondary" : "primary"} onClick={download}>
          <Download className="h-4 w-4" /> Download sheet
        </Button>
      </Step>
      <Step n={2} title="Load your counts" active={!!downloaded || !!rows}>
        <p className="text-sm text-muted">Save the filled sheet as CSV and choose it here. Nothing changes until you confirm in step 3.</p>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        <Button className="mt-3" onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" /> Choose counted sheet
        </Button>
        {problem && <p className="mt-2 text-sm text-bad">{problem}</p>}
        <ErrorNote error={check.error} />
      </Step>
      <Step n={3} title="Check and save the changes" active={!!preview}>
        {!preview ? (
          <p className="text-sm text-muted">The differences between your counts and the system appear here.</p>
        ) : preview.applied ? (
          <p className="rounded-lg bg-ok-soft px-3 py-2 text-ok">
            Saved. {preview.changes.length} lot{preview.changes.length === 1 ? "" : "s"} updated, stock value changed by {money(preview.valueChange)}.{" "}
            <Link to="/inventory" className="font-medium underline">
              Back to inventory
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              {preview.checked} lot{preview.checked === 1 ? "" : "s"} counted · <b>{preview.changes.length}</b> differ{preview.changes.length === 1 ? "s" : ""} · value change <b className={preview.valueChange < 0 ? "text-bad" : "text-ok"}>{money(preview.valueChange)}</b>
            </p>
            {flagged > 0 && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{flagged} lot{flagged === 1 ? "" : "s"} moved after the sheet was downloaded (marked below). Check those counts before saving.</p>}
            {preview.changes.length > 0 && (
              <Table head={["Part", "Lot", R("System"), R("Counted"), R("Difference"), R("Value")]}>
                {preview.changes.map((c) => (
                  <tr key={c.lotId} className={cx(c.movedSinceDownload && "bg-warn-soft/50")}>
                    <Td className="font-medium">{c.partNumber}</Td>
                    <Td className="num">
                      {c.lotNumber}
                      {c.movedSinceDownload && <span className="ml-1 text-xs text-warn">moved since download</span>}
                    </Td>
                    <Td right>{q4(c.before)}</Td>
                    <Td right>{q4(c.counted)}</Td>
                    <Td right className={c.delta < 0 ? "text-bad" : "text-ok"}>
                      {c.delta > 0 ? "+" : ""}
                      {q4(c.delta)}
                    </Td>
                    <Td right>{money(c.value)}</Td>
                  </tr>
                ))}
              </Table>
            )}
            <ErrorNote error={apply.error} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => (setRows(null), setPreview(null))}>
                Start over
              </Button>
              <Button variant="primary" disabled={!preview.changes.length || apply.isPending} onClick={() => apply.mutate()}>
                {apply.isPending ? "Saving…" : `Save ${preview.changes.length} change${preview.changes.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}
      </Step>
    </div>
  );
}

/** Compact stock summary for the part page. */
export function PartStock({ itemId }: { itemId: string }) {
  const s = useQuery({ queryKey: ["item-stock", itemId], queryFn: () => api<ItemStock>(`/inventory/items/${itemId}`) });
  const lots = useMemo(() => (s.data?.lots ?? []).filter((l) => l.quantity > 0), [s.data]);
  if (!s.data) return s.error ? <ErrorNote error={s.error} /> : <Loading />;
  const d = s.data;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["On hand", `${q4(d.onHand)} ${d.item.uom}`],
          ["Needed by jobs", q4(d.needed)],
          ["Available", q4(d.available)],
          ["Value", money(d.value)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-panel-2 px-3 py-2.5">
            <div className="text-xs text-muted">{k}</div>
            <div className={cx("num mt-0.5 text-lg font-semibold", k === "Available" && d.available < 0 && "text-bad")}>{v}</div>
          </div>
        ))}
      </div>
      <Table head={["Lot", "Location", "Size", R("Quantity")]} empty="No stock of this part.">
        {lots.slice(0, 6).map((l) => (
          <tr key={l.id}>
            <Td className="num">
              {l.lotNumber} {l.remnant && <Badge tone="accent">Remnant</Badge>}
            </Td>
            <Td>{l.location}</Td>
            <Td className="text-muted">{l.dimensions ?? "—"}</Td>
            <Td right>{q4(l.quantity)}</Td>
          </tr>
        ))}
      </Table>
      <Link to={`/inventory/${itemId}`} className="inline-block text-sm font-medium text-accent hover:underline">
        Open stock, transactions and certificates
      </Link>
    </div>
  );
}
