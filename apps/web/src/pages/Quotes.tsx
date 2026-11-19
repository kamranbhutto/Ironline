import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { priceLine, type LineCost } from "@ironline/shared";
import { api, ApiError, qs, type Contact, type Customer, type Item, type ItemDetail, type QuoteDetail, type QuoteSummary, type WorkCenter } from "../api.ts";
import { Box } from "lucide-react";
import { FilesPanel, pollWhilePreparing, type FileRow } from "../components/Files.tsx";
import { useThumb } from "../thumbs.ts";
import { Badge, Button, ButtonLink, Card, cx, DetailTitle, MetricCard, MoreMenu, ErrorNote, Field, InsetField, insetControl, Input, Loading, Modal, PageHeader, PillTabs, recordCard, SearchBox, Select, StageTimeline, Status, TabPanel, Table, Td, R, ListBar, ViewTabs } from "../components/ui.tsx";
import { date, isPast, money, num } from "../format.ts";

export function QuotesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const nav = useNavigate();
  const list = useQuery({ queryKey: ["quotes", status, q], queryFn: () => api<QuoteSummary[]>(`/quotes${qs({ q, status })}`) });
  return (
    <>
      <PageHeader title="Quotes" sub="Estimates priced from machine time, material and outside services" actions={<ButtonLink to="/quotes/new" variant="primary"><Plus className="h-4 w-4" /> New quote</ButtonLink>} />
      <Card pad={false}>
        <ListBar>
          <ViewTabs views={[{ key: "", label: "All" }, { key: "draft", label: "Draft" }, { key: "sent", label: "Sent" }, { key: "won", label: "Won" }, { key: "lost", label: "Lost" }]} value={status} onChange={setStatus} />
          <div className="ml-auto w-full sm:w-72">
            <SearchBox value={q} onChange={setQ} placeholder="Search quote number or customer" />
          </div>
        </ListBar>
        {list.isLoading ? <Loading /> : (
          <Table head={["Quote", "Customer", "Created", "Valid until", R("Value"), R("Margin"), "Status"]} empty="No quotes yet.">
            {(list.data ?? []).map((x) => {
              const margin = x.totalPrice > 0 ? ((x.totalPrice - x.totalCost) / x.totalPrice) * 100 : 0;
              const expired = x.status === "sent" && isPast(x.validUntil);
              return (
                <tr key={x.id} className="cursor-pointer hover:bg-panel-2" onClick={() => nav(`/quotes/${x.id}`)}>
                  <Td className="font-medium">{x.number}{x.revision > 0 && <span className="text-muted"> r{x.revision}</span>}</Td>
                  <Td>{x.customerName}</Td>
                  <Td>{date(x.createdAt)}</Td>
                  <Td className={expired ? "text-bad" : ""}>{date(x.validUntil)}</Td>
                  <Td right>{money(x.totalPrice)}</Td>
                  <Td right className={margin < 15 ? "text-bad" : ""}>{num(margin, 1)}%</Td>
                  <Td><Status value={expired ? "expired" : x.status} /></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

type OpF = { workCenterId: string; description: string; setupHours: string; runHoursPerUnit: string; rate: string };
type MatF = { kind: "material" | "service"; itemId: string; description: string; quantityPer: string; unitCost: string; scrapPct: string; perLot: boolean };
type LineF = { key: string; itemId: string; description: string; quantity: string; markupPct: string; unitPriceOverride: string; operations: OpF[]; materials: MatF[]; open: boolean };
type HeaderF = { customerId: string; contactId: string; validUntil: string; leadTimeDays: string; notes: string; terms: string };

let keySeq = 0;
const newKey = () => `l${++keySeq}`;
const n = (s: string) => (s === "" ? 0 : Number(s));
const emptyLine = (): LineF => ({ key: newKey(), itemId: "", description: "", quantity: "1", markupPct: "25", unitPriceOverride: "", operations: [], materials: [], open: true });
const QUOTE_STAGES = [
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent to customer" },
  { key: "won", label: "Won" },
];
type QuoteTab = "lines" | "files" | "orders";

const DEFAULT_TERMS = "Prices in the quoted currency, excluding tax and freight. Delivery lead time starts at receipt of order and approved drawings.";

function priced(line: LineF, rates: Map<string, number>): LineCost | null {
  const quantity = n(line.quantity);
  if (!(quantity > 0)) return null;
  return priceLine({
    quantity,
    markupPct: n(line.markupPct),
    unitPriceOverride: line.unitPriceOverride === "" ? null : n(line.unitPriceOverride),
    operations: line.operations.map((o) => ({
      setupHours: n(o.setupHours),
      runHoursPerUnit: n(o.runHoursPerUnit),
      rate: o.rate === "" ? rates.get(o.workCenterId) ?? 0 : n(o.rate),
    })),
    materials: line.materials.map((m) => ({ kind: m.kind, quantityPer: n(m.quantityPer), unitCost: n(m.unitCost), scrapPct: n(m.scrapPct), perLot: m.perLot })),
  });
}

function toBody(h: HeaderF, lines: LineF[]) {
  return {
    customerId: h.customerId,
    contactId: h.contactId || null,
    validUntil: h.validUntil || null,
    leadTimeDays: n(h.leadTimeDays),
    notes: h.notes || null,
    terms: h.terms || null,
    lines: lines.map((l) => ({
      itemId: l.itemId || null,
      description: l.description,
      quantity: n(l.quantity),
      markupPct: n(l.markupPct),
      unitPriceOverride: l.unitPriceOverride === "" ? null : n(l.unitPriceOverride),
      operations: l.operations.map((o) => ({
        workCenterId: o.workCenterId || null,
        description: o.description || null,
        setupHours: n(o.setupHours),
        runHoursPerUnit: n(o.runHoursPerUnit),
        rate: o.rate === "" ? null : n(o.rate),
      })),
      materials: l.materials.map((m) => ({ ...m, itemId: m.itemId || null, quantityPer: n(m.quantityPer), unitCost: n(m.unitCost), scrapPct: n(m.scrapPct) })),
    })),
  };
}

function fromQuote(q: QuoteDetail): { header: HeaderF; lines: LineF[] } {
  return {
    header: {
      customerId: q.customerId,
      contactId: q.contactId ?? "",
      validUntil: q.validUntil ?? "",
      leadTimeDays: String(q.leadTimeDays),
      notes: q.notes ?? "",
      terms: q.terms ?? "",
    },
    lines: q.lines.map((l) => ({
      key: newKey(),
      itemId: l.itemId ?? "",
      description: l.description,
      quantity: String(l.quantity),
      markupPct: String(l.markupPct),
      unitPriceOverride: l.unitPriceOverride == null ? "" : String(l.unitPriceOverride),
      // Read-only quotes cannot toggle lines (the form is disabled), so show them expanded.
      open: !["draft", "sent"].includes(q.status) || q.lines.length === 1,
      operations: l.operations.map((o) => ({ workCenterId: o.workCenterId ?? "", description: o.description ?? "", setupHours: String(o.setupHours), runHoursPerUnit: String(o.runHoursPerUnit), rate: String(o.rate) })),
      materials: l.materials.map((m) => ({ kind: m.kind, itemId: m.itemId ?? "", description: m.description, quantityPer: String(m.quantityPer), unitCost: String(m.unitCost), scrapPct: String(m.scrapPct), perLot: m.perLot })),
    })),
  };
}

export function QuoteEditorPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const quote = useQuery({ queryKey: ["quote", id], queryFn: () => api<QuoteDetail>(`/quotes/${id}`), enabled: !!id });
  const customers = useQuery({ queryKey: ["customers", "", ""], queryFn: () => api<Customer[]>("/customers") });
  const wcs = useQuery({ queryKey: ["work-centers"], queryFn: () => api<WorkCenter[]>("/work-centers") });
  const items = useQuery({ queryKey: ["items", "", ""], queryFn: () => api<Item[]>("/items") });

  const [header, setHeader] = useState<HeaderF>({ customerId: search.get("customer") ?? "", contactId: "", validUntil: "", leadTimeDays: "14", notes: "", terms: DEFAULT_TERMS });
  const [lines, setLines] = useState<LineF[]>([emptyLine()]);
  const [dirty, setDirty] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [tab, setTab] = useState<QuoteTab>("lines");
  const [fileCount, setFileCount] = useState<number | undefined>();

  useEffect(() => {
    if (!quote.data) return;
    const f = fromQuote(quote.data);
    setHeader(f.header);
    setLines(f.lines.length ? f.lines : [emptyLine()]);
    setDirty(false);
  }, [quote.data]);

  const contacts = useQuery({
    queryKey: ["customer", header.customerId],
    queryFn: () => api<Customer & { contacts: Contact[] }>(`/customers/${header.customerId}`),
    enabled: !!header.customerId,
  });

  useEffect(() => {
    if (id || header.contactId || !contacts.data) return;
    const primary = contacts.data.contacts.find((c) => c.isPrimary);
    if (primary && contacts.data.id === header.customerId) setHeader((h) => ({ ...h, contactId: primary.id }));
  }, [contacts.data, id, header.contactId, header.customerId]);

  const rates = useMemo(() => new Map((wcs.data ?? []).map((w) => [w.id, w.hourlyRate])), [wcs.data]);
  const results = lines.map((l) => priced(l, rates));
  const totalPrice = results.reduce((a, r) => a + (r?.totalPrice ?? 0), 0);
  const totalCost = results.reduce((a, r) => a + (r?.totalCost ?? 0), 0);
  const totalHours = results.reduce((a, r) => a + (r?.totalHours ?? 0), 0);
  const margin = totalPrice > 0 ? ((totalPrice - totalCost) / totalPrice) * 100 : 0;

  const status = quote.data?.status ?? "draft";
  const editable = status === "draft" || status === "sent";

  const done = (q: QuoteDetail) => {
    qc.setQueryData(["quote", q.id], q);
    qc.invalidateQueries({ queryKey: ["quotes"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    setDirty(false);
    if (!id) nav(`/quotes/${q.id}`, { replace: true });
  };
  const save = useMutation({
    mutationFn: () => (id ? api<QuoteDetail>(`/quotes/${id}`, "PUT", toBody(header, lines)) : api<QuoteDetail>("/quotes", "POST", toBody(header, lines))),
    onSuccess: done,
  });
  const act = useMutation({
    mutationFn: async (action: "send" | "lose" | "cancel" | "reopen") => {
      if (dirty && editable) await api(`/quotes/${id}`, "PUT", toBody(header, lines));
      return api<QuoteDetail>(`/quotes/${id}/${action}`, "POST");
    },
    onSuccess: done,
  });

  if (id && !quote.data) return quote.error ? <ErrorNote error={quote.error} /> : <Loading />;

  const fields = save.error instanceof ApiError ? save.error.fields ?? {} : {};
  const setH = (k: keyof HeaderF) => (e: { target: { value: string } }) => (setHeader({ ...header, [k]: e.target.value, ...(k === "customerId" ? { contactId: "" } : {}) }), setDirty(true));
  // Functional update: an async change (loading a catalogue part) must not overwrite edits made meanwhile.
  const update = (i: number, patch: Partial<LineF>) => (setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l))), setDirty(true));

  const fillFromItem = async (i: number, itemId: string) => {
    if (!itemId) return update(i, { itemId: "" });
    update(i, { itemId });
    const it = await api<ItemDetail>(`/items/${itemId}`);
    update(i, {
      itemId,
      description: `${it.partNumber} rev ${it.revision} — ${it.description}`,
      operations: it.routing.map((r) => ({ workCenterId: r.workCenterId, description: r.description ?? "", setupHours: String(r.setupHours), runHoursPerUnit: String(r.runHoursPerUnit), rate: "" })),
      materials: it.bom.map((b) => ({ kind: b.type === "service" ? "service" : "material", itemId: b.componentItemId, description: `${b.partNumber} ${b.description}`, quantityPer: String(b.quantityPer), unitCost: String(b.unitCost), scrapPct: String(b.scrapPct), perLot: false })),
    });
  };

  const qd = quote.data;
  const closed = status === "lost" || status === "cancelled";
  const quoteDates: Record<string, string | undefined> = {
    draft: date(qd?.createdAt ?? new Date().toISOString()),
    sent: qd?.sentAt ? date(qd.sentAt) : undefined,
    won: qd?.decidedAt && status === "won" ? date(qd.decidedAt) : undefined,
  };
  const customerName = customers.data?.find((c) => c.id === header.customerId)?.name;
  const expired = status === "sent" && isPast(header.validUntil);

  return (
    <>
      <DetailTitle
        parent={{ to: "/quotes", label: "Quotes" }}
        title={id ? <>{qd!.number}{qd!.revision > 0 && <span className="text-muted"> r{qd!.revision}</span>}</> : "New quote"}
        badge={id ? <Status value={expired ? "expired" : status} /> : undefined}
        sub={id ? <>Priced for {qd!.customerName}{header.leadTimeDays && <> · {header.leadTimeDays} day lead time</>}</> : "Price a part from its operations and materials"}
        actions={
          <>
            {editable && !dirty && id && <span className="text-sm text-muted">{save.isPending ? "Saving…" : "All changes saved"}</span>}
            {editable && (dirty || !id) ? (
              <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !header.customerId}>
                {save.isPending ? "Saving…" : id ? "Save changes" : "Save quote"}
              </Button>
            ) : status === "draft" ? (
              <Button variant="primary" onClick={() => act.mutate("send")}>Mark as sent</Button>
            ) : status === "sent" ? (
              <Button variant="primary" onClick={() => setConvertOpen(true)}>Won — create order</Button>
            ) : null}
            {id && (
              <MoreMenu
                items={[
                  ...(status === "draft" ? [{ label: "Won — create order", onClick: () => setConvertOpen(true) }] : []),
                  ...(status === "draft" && dirty ? [{ label: "Mark as sent", onClick: () => act.mutate("send") }] : []),
                  ...(status === "sent" && dirty ? [{ label: "Won — create order", onClick: () => setConvertOpen(true) }] : []),
                  ...(status === "sent" || status === "lost" ? [{ label: "Back to draft", onClick: () => act.mutate("reopen") }] : []),
                  ...(editable ? [{ label: "Mark as lost", onClick: () => act.mutate("lose"), danger: true }] : []),
                  ...(editable ? [{ label: "Cancel quote", onClick: () => act.mutate("cancel"), danger: true }] : []),
                ]}
              />
            )}
          </>
        }
      />
      <div className="mb-4 space-y-2">
        {!Object.keys(fields).length && <ErrorNote error={save.error} />}
        <ErrorNote error={act.error} />
        {qd?.salesOrders.map((o) => (
          <div key={o.id} className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
            Won — converted to sales order <Link to={`/sales-orders/${o.id}`} className="font-semibold underline">{o.number}</Link>.
          </div>
        ))}
      </div>

      <div className="mb-5 px-1">
        {closed ? (
          <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">This quote was {status === "lost" ? "lost" : "cancelled"}{qd?.decidedAt ? ` on ${date(qd.decidedAt)}` : ""}.</div>
        ) : (
          <StageTimeline stages={QUOTE_STAGES} current={status} dates={quoteDates} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
        <MetricCard label="Quote total" value={money(totalPrice)} note={`${lines.length} ${lines.length === 1 ? "line" : "lines"}`} tone="accent" />
        <MetricCard label="Estimated cost" value={money(totalCost)} note="Machine time, material and services" tone="line" />
        <MetricCard label="Profit" value={money(totalPrice - totalCost)} tone={totalPrice - totalCost < 0 ? "bad" : "ok"} note="Before overheads" />
        <MetricCard
          label="Margin"
          value={`${num(margin, 1)}%`}
          tone={totalPrice > 0 && margin < 15 ? "bad" : "ok"}
          badge={totalPrice > 0 && margin < 15 ? <Badge tone="bad">Under 15%</Badge> : undefined}
          note={totalPrice > 0 && margin < 15 ? "Check rates and markup" : "Of the quote total"}
        />
        <MetricCard label="Shop hours" value={`${num(totalHours, 1)} h`} tone="line" note={header.validUntil ? <span className={expired ? "text-bad" : ""}>Valid until {date(header.validUntil)}</span> : "No expiry set"} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className={recordCard}>
          <fieldset disabled={!editable} className="contents">
            <div className="text-[15px] font-medium">{customerName ?? qd?.customerName ?? "No customer yet"}</div>
            <div className="num mt-1 text-[28px] font-semibold leading-tight">{qd?.number ?? "New quote"}</div>
            <div className="mt-4 space-y-3">
              <InsetField label="Customer" tone={fields.customerId ? "bad" : undefined}>
                <select className={cx(insetControl, "text-[17px] font-medium")} value={header.customerId} onChange={setH("customerId")} required>
                  <option value="">Choose a customer…</option>
                  {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </InsetField>
              {fields.customerId && <div className="text-xs text-bad">{fields.customerId}</div>}
              <InsetField label="Contact">
                <select className={insetControl} value={header.contactId} onChange={setH("contactId")} disabled={!contacts.data?.contacts.length}>
                  <option value="">—</option>
                  {contacts.data?.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </InsetField>
              <div className="grid grid-cols-2 gap-3">
                <InsetField label={!id && !header.validUntil ? "Valid until (default 30 days)" : "Valid until"} tone={expired ? "bad" : undefined}>
                  <input type="date" className={cx(insetControl, expired && "text-bad")} value={header.validUntil} onChange={setH("validUntil")} />
                </InsetField>
                <InsetField label="Lead time (days)">
                  <input type="number" min={0} className={cx(insetControl, "num")} value={header.leadTimeDays} onChange={setH("leadTimeDays")} />
                </InsetField>
              </div>
              <InsetField label="Notes to customer">
                <textarea rows={3} className={cx(insetControl, "resize-y text-sm leading-relaxed")} value={header.notes} onChange={setH("notes")} placeholder="Shown on the quote" />
              </InsetField>
              <InsetField label="Terms and conditions">
                <textarea rows={5} className={cx(insetControl, "resize-y text-sm leading-relaxed")} value={header.terms} onChange={setH("terms")} />
              </InsetField>
            </div>
            {!customers.data?.length && !customers.isLoading && (
              <p className="mt-3 text-sm text-muted">No customers yet — <Link to="/customers" className="text-accent underline">add one first</Link>.</p>
            )}
          </fieldset>
        </section>

        <TabPanel
          title="Details"
          tabs={
            <PillTabs<QuoteTab>
              tabs={[
                { key: "lines", label: "Lines", count: lines.length },
                { key: "files", label: "Attachments", count: fileCount, disabled: !id, title: id ? undefined : "Save the quote first" },
                { key: "orders", label: "Orders", count: qd?.salesOrders.length, disabled: !qd?.salesOrders.length, title: qd?.salesOrders.length ? undefined : "Appears once the quote is won" },
              ]}
              value={tab}
              onChange={setTab}
            />
          }
        >
          {tab === "lines" && (
            <fieldset disabled={!editable} className="space-y-3">
              {lines.map((line, i) => (
                <LineEditor
                  key={line.key}
                  index={i}
                  line={line}
                  result={results[i] ?? null}
                  rates={rates}
                  workCenters={wcs.data ?? []}
                  items={items.data ?? []}
                  editable={editable}
                  onChange={(patch) => update(i, patch)}
                  onItem={(itemId) => fillFromItem(i, itemId)}
                  onRemove={() => (setLines(lines.filter((_, j) => j !== i)), setDirty(true))}
                  onCopy={() => (setLines([...lines.slice(0, i + 1), { ...structuredClone(line), key: newKey() }, ...lines.slice(i + 1)]), setDirty(true))}
                  error={Object.entries(fields).find(([k]) => k.startsWith(`lines.${i}.`))?.[1]}
                />
              ))}
              {editable && (
                <Button onClick={() => (setLines([...lines.map((l) => ({ ...l, open: false })), emptyLine()]), setDirty(true))}>
                  <Plus className="h-4 w-4" /> Add line
                </Button>
              )}
            </fieldset>
          )}
          {tab === "files" && id && <FilesPanel entity="quote" entityId={id} onCount={setFileCount} height={440} />}
          {tab === "orders" && (
            <ul className="divide-y divide-line">
              {qd?.salesOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2.5">
                  <Link to={`/sales-orders/${o.id}`} className="font-medium text-accent hover:underline">{o.number}</Link>
                  <Status value={o.status} />
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
      </div>

      {id && qd && (
        <ConvertDialog open={convertOpen} onClose={() => setConvertOpen(false)} quote={qd} beforeConvert={async () => { if (dirty) await api(`/quotes/${id}`, "PUT", toBody(header, lines)); }} />
      )}
    </>
  );
}

/** Snapshot of the catalogue part's 3D model, if the viewer has shown it before. */
function LineThumb({ itemId }: { itemId: string }) {
  const files = useQuery({ queryKey: ["files", "item", itemId], queryFn: () => api<FileRow[]>(`/files?entity=item&entityId=${itemId}`), enabled: !!itemId, refetchInterval: pollWhilePreparing });
  const model = (files.data ?? []).find((f) => f.kind === "cad" || f.kind === "mesh");
  const thumb = useThumb(model?.id);
  return (
    <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-panel-2">
      {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <Box className="h-6 w-6 text-muted" aria-hidden />}
    </div>
  );
}

function LineEditor(p: {
  index: number;
  line: LineF;
  result: LineCost | null;
  rates: Map<string, number>;
  workCenters: WorkCenter[];
  items: Item[];
  editable: boolean;
  error?: string;
  onChange: (patch: Partial<LineF>) => void;
  onItem: (itemId: string) => void;
  onRemove: () => void;
  onCopy: () => void;
}) {
  const { line, result: r, onChange } = p;
  const setOp = (j: number, patch: Partial<OpF>) => onChange({ operations: line.operations.map((o, k) => (k === j ? { ...o, ...patch } : o)) });
  const setMat = (j: number, patch: Partial<MatF>) => onChange({ materials: line.materials.map((m, k) => (k === j ? { ...m, ...patch } : m)) });
  const breaks = useMemo(() => {
    const q = n(line.quantity);
    if (!(q > 0)) return [];
    const qs = [...new Set([Math.max(1, Math.round(q / 2)), q, q * 2, q * 5])];
    return qs.map((quantity) => priced({ ...line, quantity: String(quantity), unitPriceOverride: "" }, p.rates)!);
  }, [line, p.rates]);

  return (
    <section className="rounded-xl bg-panel ring-1 ring-line">
      <header className="flex flex-wrap items-center gap-4 p-3">
        <button type="button" onClick={() => onChange({ open: !line.open })} aria-expanded={line.open} className="flex min-w-0 flex-1 items-center gap-4 text-left">
          <LineThumb itemId={line.itemId} />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted">Line {p.index + 1}</div>
            <div className="truncate text-[17px] font-semibold">{line.description || <span className="text-muted">New line</span>}</div>
            <span className={cx("mt-1 inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium", line.itemId ? "bg-accent-soft text-accent" : "bg-ok-soft text-ok")}>{line.itemId ? "Catalogue part" : "Custom"}</span>
          </div>
        </button>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Quantity", r ? num(r.quantity, 4) : "—"],
            ["Unit price", r ? money(r.unitPrice) : "—"],
            ["Total", r ? money(r.totalPrice) : "—"],
          ].map(([k, v]) => (
            <div key={k} className="min-w-24 rounded-lg bg-panel-2 px-3 py-2 text-center">
              <div className="text-xs text-muted">{k}</div>
              <div className="num mt-0.5 font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {r && <Badge tone={r.marginPct < 15 ? "bad" : "ok"}>{num(r.marginPct, 1)}%</Badge>}
          {p.editable && (
            <>
              <Button variant="ghost" aria-label="Duplicate line" onClick={p.onCopy}><Copy className="h-4 w-4" /></Button>
              <Button variant="ghost" aria-label="Remove line" onClick={p.onRemove}><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
          <button type="button" aria-label={line.open ? "Collapse line" : "Expand line"} onClick={() => onChange({ open: !line.open })} className="rounded p-1.5 text-muted hover:bg-panel-2">
            {line.open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </div>
      </header>
      {p.error && <div className="px-4 pb-2 text-xs text-bad">{p.error}</div>}
      {line.open && (
        <div className="space-y-5 border-t border-line p-4">
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Field label="Part from catalogue" hint="Fills routing and BOM">
                <Select value={line.itemId} onChange={(e) => p.onItem(e.target.value)}>
                  <option value="">One-off part</option>
                  {p.items.filter((i) => i.type === "manufactured" || i.type === "purchased").map((i) => <option key={i.id} value={i.id}>{i.partNumber} rev {i.revision}</option>)}
                </Select>
              </Field>
            </div>
            <div className="sm:col-span-4"><Field label="Description"><Input value={line.description} onChange={(e) => onChange({ description: e.target.value })} required /></Field></div>
            <Field label="Quantity"><Input type="number" min={0} step="any" value={line.quantity} onChange={(e) => onChange({ quantity: e.target.value })} /></Field>
            <Field label="Markup %"><Input type="number" step="0.5" value={line.markupPct} onChange={(e) => onChange({ markupPct: e.target.value })} /></Field>
            <Field label="Fixed unit price"><Input type="number" min={0} step="0.01" placeholder={r ? money(r.unitCost * (1 + n(line.markupPct) / 100)) : "From markup"} value={line.unitPriceOverride} onChange={(e) => onChange({ unitPriceOverride: e.target.value })} /></Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Operations</h3>
              {p.editable && <Button onClick={() => onChange({ operations: [...line.operations, { workCenterId: p.workCenters[0]?.id ?? "", description: "", setupHours: "0", runHoursPerUnit: "0", rate: "" }] })}><Plus className="h-4 w-4" /> Operation</Button>}
            </div>
            {line.operations.length === 0 ? (
              <p className="rounded-lg bg-panel-2 px-3 py-3 text-sm text-muted">No operations yet. Add machining, forming, welding or inspection steps.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg ring-1 ring-line">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-panel-2/60 text-[13px] text-muted">
                    <tr>
                      <th className="w-10 px-2 py-2 text-left font-medium">Op</th>
                      <th className="w-32 px-2 py-2 text-left font-medium">Work center</th>
                      <th className="px-2 py-2 text-left font-medium">Step</th>
                      <th className="w-20 px-2 py-2 text-right font-medium">Setup h</th>
                      <th className="w-20 px-2 py-2 text-right font-medium">Run h / pc</th>
                      <th className="w-20 px-2 py-2 text-right font-medium">Rate</th>
                      <th className="w-28 px-2 py-2 text-right font-medium">Cost</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {line.operations.map((o, j) => (
                      <tr key={j}>
                        <td className="num px-2 py-1.5 text-muted">{(j + 1) * 10}</td>
                        <td className="px-2 py-1.5">
                          <Select aria-label="Work center" value={o.workCenterId} onChange={(e) => setOp(j, { workCenterId: e.target.value })} className="py-1.5">
                            <option value="">—</option>
                            {p.workCenters.map((w) => <option key={w.id} value={w.id} title={w.name}>{w.code}</option>)}
                          </Select>
                        </td>
                        <td className="px-2 py-1.5"><Input aria-label="Step" value={o.description} placeholder={p.workCenters.find((w) => w.id === o.workCenterId)?.name} onChange={(e) => setOp(j, { description: e.target.value })} className="py-1.5" /></td>
                        <td className="px-2 py-1.5"><Input aria-label="Setup hours" type="number" min={0} step="0.01" value={o.setupHours} onChange={(e) => setOp(j, { setupHours: e.target.value })} className="num py-1.5 text-right" /></td>
                        <td className="px-2 py-1.5"><Input aria-label="Run hours per piece" type="number" min={0} step="0.001" value={o.runHoursPerUnit} onChange={(e) => setOp(j, { runHoursPerUnit: e.target.value })} className="num py-1.5 text-right" /></td>
                        <td className="px-2 py-1.5"><Input aria-label="Hourly rate" type="number" min={0} step="0.01" placeholder={String(p.rates.get(o.workCenterId) ?? 0)} value={o.rate} onChange={(e) => setOp(j, { rate: e.target.value })} className="num py-1.5 text-right" /></td>
                        <td className="num px-2 py-1.5 text-right">{r ? money(r.operationCosts[j]) : "—"}</td>
                        <td className="px-1 py-1.5 text-right">
                          {p.editable && <button type="button" aria-label="Remove operation" className="rounded p-1.5 text-muted hover:bg-bad-soft hover:text-bad" onClick={() => onChange({ operations: line.operations.filter((_, k) => k !== j) })}><Trash2 className="h-4 w-4" /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Materials and outside services</h3>
              {p.editable && (
                <div className="flex gap-2">
                  <Button onClick={() => onChange({ materials: [...line.materials, { kind: "material", itemId: "", description: "", quantityPer: "1", unitCost: "0", scrapPct: "0", perLot: false }] })}><Plus className="h-4 w-4" /> Material</Button>
                  <Button onClick={() => onChange({ materials: [...line.materials, { kind: "service", itemId: "", description: "", quantityPer: "1", unitCost: "0", scrapPct: "0", perLot: true }] })}><Plus className="h-4 w-4" /> Service</Button>
                </div>
              )}
            </div>
            {line.materials.length === 0 ? (
              <p className="rounded-lg bg-panel-2 px-3 py-3 text-sm text-muted">No materials yet. Add stock, hardware, or services such as plating or heat treat.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg ring-1 ring-line">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-panel-2/60 text-[13px] text-muted">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium">Material or service</th>
                      <th className="w-24 px-2 py-2 text-right font-medium">Qty</th>
                      <th className="w-28 px-2 py-2 text-right font-medium">Unit cost</th>
                      <th className="w-28 px-2 py-2 text-right font-medium">Scrap % / lot</th>
                      <th className="w-28 px-2 py-2 text-right font-medium">Cost</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {line.materials.map((m, j) => (
                      <tr key={j}>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className={cx("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", m.kind === "service" ? "bg-info-soft text-info" : "bg-panel-2 text-muted")}>{m.kind === "service" ? "Service" : "Material"}</span>
                            <Input aria-label="Description" value={m.description} onChange={(e) => setMat(j, { description: e.target.value })} required className="py-1.5" />
                          </div>
                        </td>
                        <td className="px-2 py-1.5"><Input aria-label={m.perLot ? "Quantity per lot" : "Quantity per piece"} title={m.perLot ? "Per lot" : "Per piece"} type="number" min={0} step="any" value={m.quantityPer} onChange={(e) => setMat(j, { quantityPer: e.target.value })} className="num py-1.5 text-right" /></td>
                        <td className="px-2 py-1.5"><Input aria-label="Unit cost" type="number" min={0} step="0.0001" value={m.unitCost} onChange={(e) => setMat(j, { unitCost: e.target.value })} className="num py-1.5 text-right" /></td>
                        <td className="px-2 py-1.5 text-right">
                          {m.kind === "material" ? (
                            <Input aria-label="Scrap percent" type="number" min={0} step="0.1" value={m.scrapPct} onChange={(e) => setMat(j, { scrapPct: e.target.value })} className="num py-1.5 text-right" />
                          ) : (
                            <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={m.perLot} onChange={(e) => setMat(j, { perLot: e.target.checked })} /> Per lot</label>
                          )}
                        </td>
                        <td className="num px-2 py-1.5 text-right">{r ? money(r.materialCosts[j]) : "—"}</td>
                        <td className="px-1 py-1.5 text-right">
                          {p.editable && <button type="button" aria-label="Remove material" className="rounded p-1.5 text-muted hover:bg-bad-soft hover:text-bad" onClick={() => onChange({ materials: line.materials.filter((_, k) => k !== j) })}><Trash2 className="h-4 w-4" /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {r && (
            <div className="grid gap-4 border-t border-line pt-4 md:grid-cols-2">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Labor & machine</dt><dd className="num text-right">{money(r.laborCost)}</dd>
                <dt className="text-muted">Material</dt><dd className="num text-right">{money(r.materialCost)}</dd>
                <dt className="text-muted">Outside services</dt><dd className="num text-right">{money(r.serviceCost)}</dd>
                <dt className="font-medium">Cost</dt><dd className="num text-right font-medium">{money(r.totalCost)} <span className="text-xs text-muted">({money(r.unitCost)} / pc)</span></dd>
              </dl>
              <div>
                <div className="mb-1 text-xs font-semibold text-muted">Price at other quantities</div>
                <table className="num w-full text-sm">
                  <tbody>
                    {breaks.map((b) => (
                      <tr key={b.quantity} className={b.quantity === r.quantity ? "font-semibold" : "text-muted"}>
                        <td className="py-0.5">{num(b.quantity, 4)} pcs</td>
                        <td className="py-0.5 text-right">{money(b.unitPrice)} / pc</td>
                        <td className="py-0.5 text-right">{money(b.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ConvertDialog({ open, onClose, quote, beforeConvert }: { open: boolean; onClose: () => void; quote: QuoteDetail; beforeConvert: () => Promise<void> }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [po, setPo] = useState("");
  const [due, setDue] = useState("");
  const [createJobs, setCreateJobs] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => setChosen(quote.lines.map((l) => l.id)), [quote.lines]);
  const convert = useMutation({
    mutationFn: async () => {
      await beforeConvert();
      return api<{ id: string }>(`/quotes/${quote.id}/convert`, "POST", { customerPo: po || null, dueDate: due || null, createJobs, lineIds: chosen.length === quote.lines.length ? [] : chosen });
    },
    onSuccess: (o) => {
      qc.invalidateQueries();
      nav(`/sales-orders/${o.id}`);
    },
  });
  return (
    <Modal open={open} title="Convert to sales order" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), convert.mutate())} className="space-y-4">
        <p className="text-sm text-muted">The quote will be marked won. Prices are copied to the order as quoted.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer PO number"><Input value={po} onChange={(e) => setPo(e.target.value)} autoFocus /></Field>
          <Field label="Due date" hint={`Default: today + ${quote.leadTimeDays} days`}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Lines to order</div>
          <div className="space-y-1">
            {quote.lines.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.includes(l.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, l.id] : chosen.filter((x) => x !== l.id))} />
                <span className="flex-1 truncate">{l.description}</span>
                <span className="num text-muted">{money(l.totalPrice)}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createJobs} onChange={(e) => setCreateJobs(e.target.checked)} /> Create a job for every line now
        </label>
        <ErrorNote error={convert.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={convert.isPending || !chosen.length}>Create sales order</Button>
        </div>
      </form>
    </Modal>
  );
}
