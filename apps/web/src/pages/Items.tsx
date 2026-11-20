import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError, qs, type Item, type ItemDetail, type WorkCenter } from "../api.ts";
import { BomBuilder } from "../components/BomBuilder.tsx";
import { FilesPanel, PendingFiles, pollWhilePreparing, uploadFiles, type FileRow } from "../components/Files.tsx";
import { InspectionPlan } from "../components/InspectionPlan.tsx";
import { PartStock } from "./Inventory.tsx";
import { Badge, Button, ButtonLink, Card, cx, DetailTitle, ErrorNote, InsetField, insetControl, Loading, MetricCard, PageHeader, PillTabs, recordCard, SearchBox, Status, TabPanel, Table, Td, R, ListBar, ViewTabs } from "../components/ui.tsx";
import { money, num } from "../format.ts";

const TYPES = [
  ["manufactured", "Made in house"],
  ["purchased", "Bought finished"],
  ["material", "Raw material"],
  ["service", "Outside service"],
] as const;
const typeLabel = (t: string) => TYPES.find((x) => x[0] === t)?.[1] ?? t;

export function ItemsPage() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const nav = useNavigate();
  const list = useQuery({ queryKey: ["items", q, type], queryFn: () => api<Item[]>(`/items${qs({ q, type })}`) });
  return (
    <>
      <PageHeader
        title="Parts & materials"
        sub="Everything you make, buy or stock, with routings and bills of material"
        actions={<ButtonLink to="/items/new" variant="primary"><Plus className="h-4 w-4" /> Add part</ButtonLink>}
      />
      <Card pad={false}>
        <ListBar>
          <ViewTabs views={[{ key: "", label: "All" }, { key: "manufactured", label: "Made in house" }, { key: "purchased", label: "Bought" }, { key: "material", label: "Raw material" }, { key: "service", label: "Services" }]} value={type} onChange={setType} />
          <div className="ml-auto w-full sm:w-72">
            <SearchBox value={q} onChange={setQ} placeholder="Search part number or description" />
          </div>
        </ListBar>
        {list.isLoading ? <Loading /> : (
          <Table head={["Part number", "Rev", "Description", "Type", R("Unit cost"), R("Price"), ""]} empty="No parts yet.">
            {(list.data ?? []).map((i) => (
              <tr key={i.id} className="cursor-pointer hover:bg-panel-2" onClick={() => nav(`/items/${i.id}`)}>
                <Td className="num font-medium">{i.partNumber}</Td>
                <Td>{i.revision}</Td>
                <Td className="max-w-80 truncate">{i.description}</Td>
                <Td><span className="rounded-md bg-panel-2 px-2 py-0.5 text-xs">{typeLabel(i.type)}</span></Td>
                <Td right>{i.unitCost ? money(i.unitCost) : "—"}</Td>
                <Td right>{i.salePrice ? money(i.salePrice) : "—"}</Td>
                <Td>{!i.active && <Status value="inactive" />}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

type PartTab = "files" | "cost" | "stock";
type Op = { workCenterId: string; description: string; setupHours: string; runHoursPerUnit: string };
type Bom = { componentItemId: string; quantityPer: string; scrapPct: string };
type Form = { partNumber: string; revision: string; description: string; type: string; uom: string; unitCost: string; salePrice: string; active: boolean; routing: Op[]; bom: Bom[] };
const blank: Form = { partNumber: "", revision: "A", description: "", type: "manufactured", uom: "ea", unitCost: "0", salePrice: "0", active: true, routing: [], bom: [] };

export function ItemEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const item = useQuery({ queryKey: ["item", id], queryFn: () => api<ItemDetail>(`/items/${id}`), enabled: !!id });
  const wcs = useQuery({ queryKey: ["work-centers"], queryFn: () => api<WorkCenter[]>("/work-centers") });
  const parts = useQuery({ queryKey: ["items", "", ""], queryFn: () => api<Item[]>("/items") });
  const files = useQuery({ queryKey: ["files", "item", id], queryFn: () => api<FileRow[]>(`/files?entity=item&entityId=${id}`), enabled: !!id, refetchInterval: pollWhilePreparing });
  const [form, setForm] = useState<Form>(blank);
  const [tab, setTab] = useState<PartTab>("files");
  const [fileCount, setFileCount] = useState<number | undefined>();
  const [queued, setQueued] = useState<File[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const uploadError = (useLocation().state as { uploadError?: string } | null)?.uploadError;

  useEffect(() => {
    const d = item.data;
    if (!d) return;
    setForm({
      partNumber: d.partNumber,
      revision: d.revision,
      description: d.description,
      type: d.type,
      uom: d.uom,
      unitCost: String(d.unitCost),
      salePrice: String(d.salePrice),
      active: d.active,
      routing: d.routing.map((r) => ({ workCenterId: r.workCenterId, description: r.description ?? "", setupHours: String(r.setupHours), runHoursPerUnit: String(r.runHoursPerUnit) })),
      bom: d.bom.map((b) => ({ componentItemId: b.componentItemId, quantityPer: String(b.quantityPer), scrapPct: String(b.scrapPct) })),
    });
  }, [item.data]);

  const save = useMutation({
    mutationFn: (_files?: File[]) => {
      const body = {
        ...form,
        unitCost: Number(form.unitCost || 0),
        salePrice: Number(form.salePrice || 0),
        routing: form.routing.map((r) => ({ ...r, setupHours: Number(r.setupHours || 0), runHoursPerUnit: Number(r.runHoursPerUnit || 0) })),
        bom: form.bom.map((b) => ({ ...b, quantityPer: Number(b.quantityPer || 0), scrapPct: Number(b.scrapPct || 0) })),
      };
      return id ? api<ItemDetail>(`/items/${id}`, "PUT", body) : api<ItemDetail>("/items", "POST", body);
    },
    onSuccess: async (saved, dropped) => {
      const toUpload = dropped ?? queued;
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.setQueryData(["item", saved.id], saved);
      if (!id) {
        // Drawings dropped before the first save go up now that the part exists.
        let uploadError: string | undefined;
        if (toUpload.length) {
          try {
            await uploadFiles("item", saved.id, toUpload);
          } catch (e) {
            uploadError = `The part was saved, but a drawing did not upload: ${(e as Error).message}. Drop it again below.`;
          }
        }
        nav(`/items/${saved.id}`, { replace: true, state: uploadError ? { uploadError } : null });
      }
    },
  });

  if (id && !item.data) return item.error ? <ErrorNote error={item.error} /> : <Loading />;
  const fields = save.error instanceof ApiError ? save.error.fields ?? {} : {};
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const rate = (wcId: string) => wcs.data?.find((w) => w.id === wcId)?.hourlyRate ?? 0;
  const laborPerPiece = form.routing.reduce((a, r) => a + Number(r.runHoursPerUnit || 0) * rate(r.workCenterId), 0);
  const setupCost = form.routing.reduce((a, r) => a + Number(r.setupHours || 0) * rate(r.workCenterId), 0);
  const matPerPiece = form.bom.reduce((a, b) => {
    const c = parts.data?.find((p) => p.id === b.componentItemId);
    return a + (c ? c.unitCost * Number(b.quantityPer || 0) * (1 + Number(b.scrapPct || 0) / 100) : 0);
  }, 0);

  const made = form.type === "manufactured";
  const has = form.routing.length > 0 || form.bom.length > 0;
  const cost10 = made ? (has ? setupCost / 10 + laborPerPiece + matPerPiece : null) : Number(form.unitCost || 0);
  const price = Number(form.salePrice || 0);
  const marginPct = cost10 != null && price > 0 ? ((price - cost10) / price) * 100 : null;
  const hoursPerPiece = form.routing.reduce((a, r) => a + Number(r.runHoursPerUnit || 0), 0);
  const custom = /^Q-\d+-\d+$/.test(form.partNumber);

  return (
    <form ref={formRef} onSubmit={(e) => (e.preventDefault(), save.mutate(undefined))}>
      <DetailTitle
        parent={{ to: "/items", label: "Parts & materials" }}
        title={id ? <>{form.partNumber}<span className="font-normal text-muted"> rev {form.revision}</span></> : "New part"}
        badge={id ? <Badge tone={custom ? "ok" : "accent"}>{custom ? "Custom" : typeLabel(form.type)}</Badge> : undefined}
        sub={id ? form.description : "Part number, routing and bill of material"}
        actions={
          <>
            {save.isSuccess && <span className="text-sm text-ok">Saved</span>}
            <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? (queued.length ? "Saving and uploading…" : "Saving…") : "Save part"}</Button>
          </>
        }
      />
      {!Object.keys(fields).length && <div className="mb-4"><ErrorNote error={save.error} /></div>}
      {uploadError && <div className="mb-4"><ErrorNote error={new Error(uploadError)} /></div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
        <MetricCard label={made ? "Cost per piece" : "Unit cost"} value={money(cost10)} tone="line" note={made ? (has ? "At a batch of 10" : "Add routing and materials") : `Per ${form.uom || "unit"}`} />
        <MetricCard label="List price" value={price ? money(price) : "—"} tone="accent" note={price ? `Per ${form.uom || "unit"}` : "Not set"} />
        <MetricCard
          label="Margin"
          value={marginPct == null ? "—" : `${num(marginPct, 1)}%`}
          tone={marginPct == null ? "line" : marginPct < 15 ? "bad" : "ok"}
          badge={marginPct != null && marginPct < 15 ? <Badge tone="bad">Under 15%</Badge> : undefined}
          note={marginPct == null ? "Needs a cost and a price" : made ? "At list price, batch of 10" : "At list price"}
        />
        {made && <MetricCard label="Setup per job" value={money(setupCost)} tone="line" note={`${num(form.routing.reduce((a, r) => a + Number(r.setupHours || 0), 0), 2)} h before the first piece`} />}
        {made && <MetricCard label="Run time" value={`${num(hoursPerPiece * 60, 1)} min`} tone="line" note={`Per piece over ${form.routing.length} ${form.routing.length === 1 ? "step" : "steps"}`} />}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className={recordCard}>
          <div className="text-[15px] font-medium">{typeLabel(form.type)}</div>
          <div className="num mt-1 truncate text-[28px] font-semibold leading-tight">{form.partNumber || "New part"}</div>
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <InsetField label="Part number" className="col-span-2" tone={fields.partNumber ? "bad" : undefined}>
                <input className={cx(insetControl, "num font-medium")} value={form.partNumber} onChange={set("partNumber")} required />
              </InsetField>
              <InsetField label="Revision"><input className={insetControl} value={form.revision} onChange={set("revision")} /></InsetField>
            </div>
            {fields.partNumber && <div className="text-xs text-bad">{fields.partNumber}</div>}
            <InsetField label="Description" tone={fields.description ? "bad" : undefined}>
              <textarea rows={2} className={cx(insetControl, "resize-y")} value={form.description} onChange={set("description")} required />
            </InsetField>
            <div className="grid grid-cols-2 gap-3">
              <InsetField label="Type">
                <select className={insetControl} value={form.type} onChange={set("type")}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </InsetField>
              <InsetField label="Unit"><input className={insetControl} value={form.uom} onChange={set("uom")} /></InsetField>
              {made ? (
                <InsetField label="Cost per piece (from routing)">
                  <div className="num text-[15px]">{money(cost10)}</div>
                </InsetField>
              ) : (
                <InsetField label="Unit cost"><input type="number" step="0.0001" min={0} className={cx(insetControl, "num")} value={form.unitCost} onChange={set("unitCost")} /></InsetField>
              )}
              <InsetField label="List price"><input type="number" step="0.01" min={0} className={cx(insetControl, "num")} value={form.salePrice} onChange={set("salePrice")} /></InsetField>
            </div>
            <InsetField label="Status" tone={form.active ? "ok" : undefined}>
              <select className={insetControl} value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
                <option value="1">Active</option>
                <option value="0">Inactive (hidden from new quotes)</option>
              </select>
            </InsetField>
          </div>
        </section>

        <TabPanel
          title="Details"
          tabs={
            <PillTabs<PartTab>
              tabs={[
                { key: "files", label: "Drawings & 3D", count: fileCount },
                { key: "cost", label: "Cost", disabled: !made },
                { key: "stock", label: "Stock", disabled: !id },
              ]}
              value={tab}
              onChange={setTab}
            />
          }
        >
          {tab === "files" &&
            (id ? (
              <FilesPanel entity="item" entityId={id} height={460} onCount={setFileCount} />
            ) : (
              <PendingFiles
                files={queued}
                busy={save.isPending}
                onChange={(fs) => {
                  // Drawing first: once the part has a number and description, a dropped drawing
                  // saves the part straight away and opens in the viewer, ready for the routing.
                  if (fs.length > queued.length && form.partNumber.trim() && form.description.trim() && formRef.current?.checkValidity()) {
                    save.mutate(fs);
                  } else {
                    setQueued(fs);
                  }
                }}
              />
            ))}
          {tab === "stock" && id && <PartStock itemId={id} />}
          {tab === "cost" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Setup (once per job)", setupCost],
                  ["Labor per piece", laborPerPiece],
                  ["Material per piece", matPerPiece],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-lg bg-panel-2 px-3 py-2.5">
                    <div className="text-xs text-muted">{k}</div>
                    <div className="num mt-0.5 text-lg font-semibold">{money(v as number)}</div>
                  </div>
                ))}
              </div>
              <Table head={["Batch size", R("Cost each"), R("Batch cost"), R("Margin at list")]}>
                {[1, 10, 25, 100, 500].map((q) => {
                  const each = setupCost / q + laborPerPiece + matPerPiece;
                  return (
                    <tr key={q}>
                      <Td className="num">{q} {form.uom}</Td>
                      <Td right>{money(each)}</Td>
                      <Td right>{money(each * q)}</Td>
                      <Td right className={price && (price - each) / price < 0.15 ? "text-bad" : "text-muted"}>{price ? `${num(((price - each) / price) * 100, 1)}%` : "—"}</Td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          )}
        </TabPanel>
      </div>

      {(made || form.routing.length > 0 || form.bom.length > 0) &&
        (wcs.data?.length ? (
          <BomBuilder
            partId={id}
            partNumber={form.partNumber}
            description={form.description}
            uom={form.uom}
            routing={form.routing}
            bom={form.bom}
            onRouting={(routing) => setForm((f) => ({ ...f, routing }))}
            onBom={(bom) => setForm((f) => ({ ...f, bom }))}
            workCenters={wcs.data}
            parts={parts.data ?? []}
            unitCost={made ? (has ? setupCost / 10 + laborPerPiece + matPerPiece : null) : Number(form.unitCost || 0)}
          />
        ) : (
          <p className="mt-5 rounded-xl bg-panel p-4 text-sm text-muted shadow-panel ring-1 ring-line/70">Add work centers first under Setup → Work centers, then build this part's routing here.</p>
        ))}

      {id && made && (
        <InspectionPlan
          itemId={id}
          files={files.data ?? []}
          operations={form.routing.map((r, i) => ({
            sequence: (i + 1) * 10,
            label: `${(i + 1) * 10} · ${wcs.data?.find((w) => w.id === r.workCenterId)?.name ?? "Step"}${r.description ? ` — ${r.description}` : ""}`,
          }))}
        />
      )}
    </form>
  );
}
