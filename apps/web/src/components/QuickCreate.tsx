import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import { api, type ItemDetail, type WorkCenter } from "../api.ts";
import { Button, cx, ErrorNote, InsetField, insetControl, Modal } from "./ui.tsx";

/*
 * Small "create it here" forms for the routing and BOM editor, so a missing operation or
 * material can be added without leaving the part (and losing its unsaved changes).
 * They sit inside the part's <form>, so they use no <form> of their own: Enter is caught here
 * and never reaches the part form.
 */

const enterTo = (go: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
    e.preventDefault();
    e.stopPropagation();
    go();
  }
};

const KINDS = [
  ["machine", "Machine"],
  ["labor", "Bench or labor"],
  ["outside", "Outside service"],
] as const;

/** A new work center (an operation in the library). Calls onCreated with it once saved. */
export function NewOperationModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (wc: WorkCenter) => void }) {
  const qc = useQueryClient();
  const empty = { code: "", name: "", kind: "machine", hourlyRate: "", capacityHoursPerDay: "8" };
  const [f, setF] = useState(empty);
  const create = useMutation({
    mutationFn: () =>
      api<WorkCenter>("/work-centers", "POST", {
        code: f.code.trim().toUpperCase(),
        name: f.name.trim(),
        kind: f.kind,
        hourlyRate: Number(f.hourlyRate || 0),
        capacityHoursPerDay: Number(f.capacityHoursPerDay || 8),
      }),
    onSuccess: async (wc) => {
      await qc.invalidateQueries({ queryKey: ["work-centers"] });
      setF(empty);
      onCreated(wc);
    },
  });
  const ready = f.code.trim() && f.name.trim();
  const go = () => ready && !create.isPending && create.mutate();
  const close = () => (create.reset(), onClose());
  return (
    <Modal open={open} title="New operation" onClose={close}>
      <div className="space-y-3" onKeyDown={enterTo(go)}>
        <p className="text-sm text-muted">Adds a work center to the library and puts it on this part's routing. Edit it later under Setup → Work centers.</p>
        <div className="grid grid-cols-3 gap-3">
          <InsetField label="Code">
            <input autoFocus className={cx(insetControl, "num uppercase")} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="WELD" maxLength={30} />
          </InsetField>
          <InsetField label="Name" className="col-span-2">
            <input className={insetControl} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="TIG welding" maxLength={120} />
          </InsetField>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <InsetField label="Kind">
            <select className={insetControl} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </InsetField>
          <InsetField label="Rate per hour">
            <input type="number" min={0} step="0.01" className={cx(insetControl, "num")} value={f.hourlyRate} onChange={(e) => setF({ ...f, hourlyRate: e.target.value })} placeholder="0.00" />
          </InsetField>
          <InsetField label="Hours per day">
            <input type="number" min={0} max={24} step="0.5" className={cx(insetControl, "num")} value={f.capacityHoursPerDay} onChange={(e) => setF({ ...f, capacityHoursPerDay: e.target.value })} />
          </InsetField>
        </div>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready || create.isPending} onClick={go}>{create.isPending ? "Adding…" : "Add operation"}</Button>
        </div>
      </div>
    </Modal>
  );
}

const PART_TYPES = [
  ["material", "Raw material"],
  ["purchased", "Bought finished"],
  ["manufactured", "Made in house"],
  ["service", "Outside service"],
] as const;

/** A new part or material for the BOM. Calls onCreated with it once saved. */
export function NewComponentModal({
  open,
  kind,
  onClose,
  onCreated,
}: {
  open: boolean;
  kind: "material" | "part";
  onClose: () => void;
  onCreated: (item: ItemDetail) => void;
}) {
  const qc = useQueryClient();
  const empty = { partNumber: "", description: "", type: kind === "material" ? "material" : "purchased", uom: kind === "material" ? "ft" : "ea", unitCost: "" };
  const [f, setF] = useState(empty);
  const [lastKind, setLastKind] = useState(kind);
  if (kind !== lastKind) (setLastKind(kind), setF(empty));
  const create = useMutation({
    mutationFn: () =>
      api<ItemDetail>("/items", "POST", {
        partNumber: f.partNumber.trim(),
        revision: "A",
        description: f.description.trim(),
        type: f.type,
        uom: f.uom.trim() || "ea",
        unitCost: Number(f.unitCost || 0),
        salePrice: 0,
        active: true,
        routing: [],
        bom: [],
      }),
    onSuccess: async (item) => {
      await qc.invalidateQueries({ queryKey: ["items"] });
      setF(empty);
      onCreated(item);
    },
  });
  const made = f.type === "manufactured";
  const ready = f.partNumber.trim() && f.description.trim();
  const go = () => ready && !create.isPending && create.mutate();
  const close = () => (create.reset(), onClose());
  const types = kind === "material" ? PART_TYPES.filter(([v]) => v === "material") : PART_TYPES.filter(([v]) => v !== "material");
  return (
    <Modal open={open} title={kind === "material" ? "New material" : "New part"} onClose={close}>
      <div className="space-y-3" onKeyDown={enterTo(go)}>
        <p className="text-sm text-muted">
          {kind === "material"
            ? "Adds a raw material (bar, sheet, tube…) and puts it on this part's bill of materials."
            : "Adds a part and puts it on this bill of materials. A made-in-house part gets its own routing and drawing later, from its own page."}
        </p>
        <InsetField label={kind === "material" ? "Material code" : "Part number"}>
          <input autoFocus className={cx(insetControl, "num font-medium")} value={f.partNumber} onChange={(e) => setF({ ...f, partNumber: e.target.value })} placeholder={kind === "material" ? "AL6061-RD-1.00" : "BRK-100"} maxLength={60} />
        </InsetField>
        <InsetField label="Description">
          <input className={insetControl} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={kind === "material" ? "6061 aluminium round bar, 1 in" : "Mounting bracket"} maxLength={500} />
        </InsetField>
        <div className="grid grid-cols-3 gap-3">
          <InsetField label="Type">
            <select className={insetControl} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} disabled={types.length === 1}>
              {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </InsetField>
          <InsetField label="Unit">
            <input className={insetControl} value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value })} maxLength={20} />
          </InsetField>
          {made ? (
            <InsetField label="Cost">
              <div className="text-sm text-muted">From its routing</div>
            </InsetField>
          ) : (
            <InsetField label={`Cost per ${f.uom || "unit"}`}>
              <input type="number" min={0} step="0.0001" className={cx(insetControl, "num")} value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} placeholder="0.00" />
            </InsetField>
          )}
        </div>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready || create.isPending} onClick={go}>{create.isPending ? "Adding…" : kind === "material" ? "Add material" : "Add part"}</Button>
        </div>
      </div>
    </Modal>
  );
}
