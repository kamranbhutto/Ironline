import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError, type WorkCenter } from "../api.ts";
import { Badge, Button, cx, ErrorNote, Field, Input, Loading, MetricCard, Modal, PageHeader, Select, Status } from "../components/ui.tsx";
import { date, money, num } from "../format.ts";

const KIND: Record<string, string> = { machine: "Machine", labor: "Labor / bench", outside: "Outside process" };

type Form = { code: string; name: string; kind: string; hourlyRate: string; capacityHoursPerDay: string; active: boolean };
const blank: Form = { code: "", name: "", kind: "machine", hourlyRate: "", capacityHoursPerDay: "8", active: true };

export function WorkCentersPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["work-centers"], queryFn: () => api<WorkCenter[]>("/work-centers") });
  const [edit, setEdit] = useState<{ id?: string; form: Form } | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") === "1") (setEdit({ form: blank }), setParams({}, { replace: true }));
  }, [params, setParams]);
  const save = useMutation({
    mutationFn: () => {
      const f = edit!.form;
      const body = { ...f, hourlyRate: Number(f.hourlyRate || 0), capacityHoursPerDay: Number(f.capacityHoursPerDay || 0) };
      return edit!.id ? api(`/work-centers/${edit!.id}`, "PATCH", body) : api("/work-centers", "POST", body);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["work-centers"] }), setEdit(null)),
  });
  const board = useQuery({ queryKey: ["board"], queryFn: () => api<{ columns: { id: string; backlogHours: number; finishDate: string | null; cards: { state: string; late: boolean }[] }[] }>("/floor/board") });
  const all = list.data ?? [];
  const loads = all.map((w) => {
    const col = board.data?.columns.find((c) => c.id === w.id);
    return { code: w.code, hours: col?.backlogHours ?? 0, days: w.capacityHoursPerDay ? (col?.backlogHours ?? 0) / w.capacityHoursPerDay : 0, running: !!col?.cards.some((c) => c.state === "running") };
  });
  const totalHours = loads.reduce((a, l) => a + l.hours, 0);
  const totalCap = all.filter((w) => w.active).reduce((a, w) => a + w.capacityHoursPerDay, 0);
  const runningNow = loads.filter((l) => l.running).length;
  const busiest = loads.filter((l) => l.hours > 0).sort((x, y) => y.days - x.days)[0];
  const fields = save.error instanceof ApiError ? save.error.fields ?? {} : {};
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setEdit({ ...edit!, form: { ...edit!.form, [k]: e.target.value } });

  return (
    <>
      <PageHeader
        title="Work centers"
        sub="Machines, benches and outside processes, with the hourly rate used for quoting and costing"
        actions={
          <Button variant="primary" onClick={() => (save.reset(), setEdit({ form: blank }))}>
            <Plus className="h-4 w-4" /> Add work center
          </Button>
        }
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard label="Work centers" value={all.filter((w) => w.active).length} tone="accent" note={`${all.filter((w) => !w.active).length} inactive`} />
            <MetricCard label="Running now" value={runningNow} tone={runningNow ? "ok" : "line"} note="With a timer going" />
            <MetricCard label="Queued work" value={`${num(totalHours, 0)} h`} tone="line" note={`${num(totalCap, 0)} h of capacity a day`} />
            <MetricCard label="Busiest" value={busiest ? busiest.code : "—"} tone={busiest && busiest.days > 5 ? "warn" : "ok"} note={busiest ? `${num(busiest.days, 1)} days of work queued` : "Nothing queued"} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {all.map((w) => {
              const col = board.data?.columns.find((c) => c.id === w.id);
              const hours = col?.backlogHours ?? 0;
              const days = w.capacityHoursPerDay ? hours / w.capacityHoursPerDay : 0;
              const running = col?.cards.some((c) => c.state === "running");
              const late = col?.cards.filter((c) => c.late).length ?? 0;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => (save.reset(), setEdit({ id: w.id, form: { code: w.code, name: w.name, kind: w.kind, hourlyRate: String(w.hourlyRate), capacityHoursPerDay: String(w.capacityHoursPerDay), active: w.active } }))}
                  className={cx("flex flex-col rounded-xl bg-panel p-4 text-left shadow-panel ring-1 ring-line/70 transition hover:ring-2 hover:ring-accent", !w.active && "opacity-60")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="num text-xl font-semibold">{w.code}</div>
                      <div className="truncate text-sm text-muted">{w.name}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={w.kind === "outside" ? "accent" : "muted"}>{KIND[w.kind] ?? w.kind}</Badge>
                      {!w.active ? <Status value="inactive" /> : running ? <Status value="running" /> : null}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-panel-2 px-3 py-2">
                      <div className="text-xs text-muted">Rate</div>
                      <div className="num font-semibold">{money(w.hourlyRate)}/h</div>
                    </div>
                    <div className="rounded-lg bg-panel-2 px-3 py-2">
                      <div className="text-xs text-muted">Capacity</div>
                      <div className="num font-semibold">{num(w.capacityHoursPerDay)} h/day</div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-muted">
                      <span className="num">{num(hours, 1)} h queued · {col?.cards.length ?? 0} {col?.cards.length === 1 ? "job" : "jobs"}</span>
                      {late > 0 && <span className="text-bad">{late} late</span>}
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-panel-2">
                      <div className={cx("h-full rounded-full", late ? "bg-bad" : days > 5 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.min(100, (days / 10) * 100)}%` }} />
                    </div>
                    <div className="num mt-1 text-xs text-muted">{hours ? `${num(days, 1)} days of work${col?.finishDate ? ` · clear by ${date(col.finishDate)}` : ""}` : "Idle"}</div>
                  </div>
                </button>
              );
            })}
            {!all.length && <p className="text-sm text-muted">Add your machines and work areas to start quoting.</p>}
          </div>
        </>
      )}
      <Modal open={!!edit} title={edit?.id ? "Edit work center" : "Add work center"} onClose={() => setEdit(null)}>
        {edit && (
          <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" error={fields.code}>
                <Input value={edit.form.code} onChange={set("code")} required autoFocus placeholder="MILL1" />
              </Field>
              <Field label="Type">
                <Select value={edit.form.kind} onChange={set("kind")}>
                  <option value="machine">Machine</option>
                  <option value="labor">Labor / bench</option>
                  <option value="outside">Outside process</option>
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Name" error={fields.name}>
                  <Input value={edit.form.name} onChange={set("name")} required placeholder="5-axis mill" />
                </Field>
              </div>
              <Field label="Hourly rate" hint="Machine + operator burden" error={fields.hourlyRate}>
                <Input type="number" step="0.01" min={0} value={edit.form.hourlyRate} onChange={set("hourlyRate")} required />
              </Field>
              <Field label="Capacity hours per day" error={fields.capacityHoursPerDay}>
                <Input type="number" step="0.5" min={0} value={edit.form.capacityHoursPerDay} onChange={set("capacityHoursPerDay")} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={edit.form.active} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, active: e.target.checked } })} />
                Active (can be used on new quotes and jobs)
              </label>
            </div>
            {!Object.keys(fields).length && <ErrorNote error={save.error} />}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={save.isPending}>Save</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
