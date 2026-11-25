import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, qs, type Contact, type Customer, type QuoteSummary, type SalesOrderSummary } from "../api.ts";
import { Button, ButtonLink, Card, cx, DetailTitle, ErrorNote, Field, InsetField, Input, Loading, MetricCard, Modal, PageHeader, PillTabs, recordCard, SearchBox, Select, Status, TabPanel, Table, Td, Textarea, R, ListBar, ViewTabs } from "../components/ui.tsx";
import { FilesPanel } from "../components/Files.tsx";
import { date, money } from "../format.ts";

type CustomerForm = { name: string; code: string; status: string; email: string; phone: string; website: string; paymentTermsDays: string; notes: string };
const blank: CustomerForm = { name: "", code: "", status: "active", email: "", phone: "", website: "", paymentTermsDays: "30", notes: "" };

function CustomerFields({ form, setForm, fields }: { form: CustomerForm; setForm: (f: CustomerForm) => void; fields: Record<string, string> }) {
  const set = (k: keyof CustomerForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Company name" error={fields.name}>
          <Input value={form.name} onChange={set("name")} required autoFocus />
        </Field>
      </div>
      <Field label="Code" hint="Leave empty to number automatically" error={fields.code}>
        <Input value={form.code} onChange={set("code")} />
      </Field>
      <Field label="Status">
        <Select value={form.status} onChange={set("status")}>
          <option value="prospect">Prospect</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </Field>
      <Field label="E-mail" error={fields.email}>
        <Input type="email" value={form.email} onChange={set("email")} />
      </Field>
      <Field label="Phone">
        <Input value={form.phone} onChange={set("phone")} />
      </Field>
      <Field label="Website">
        <Input value={form.website} onChange={set("website")} />
      </Field>
      <Field label="Payment terms (days)" error={fields.paymentTermsDays}>
        <Input type="number" min={0} value={form.paymentTermsDays} onChange={set("paymentTermsDays")} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes">
          <Textarea value={form.notes} onChange={set("notes")} />
        </Field>
      </div>
    </div>
  );
}

const toBody = (f: CustomerForm) => ({ ...f, code: f.code || undefined, paymentTermsDays: Number(f.paymentTermsDays || 0) });

export function CustomersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("new") === "1");
  const [form, setForm] = useState(blank);
  const nav = useNavigate();
  useEffect(() => {
    if (params.get("new") === "1") (setOpen(true), setParams({}, { replace: true }));
  }, [params, setParams]);
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["customers", q, status], queryFn: () => api<Customer[]>(`/customers${qs({ q, status })}`) });
  const create = useMutation({
    mutationFn: () => api<Customer>("/customers", "POST", toBody(form)),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      nav(`/customers/${c.id}`);
    },
  });
  const fields = create.error instanceof ApiError ? create.error.fields ?? {} : {};
  return (
    <>
      <PageHeader
        title="Customers"
        sub="Companies you quote and sell to"
        actions={
          <Button variant="primary" onClick={() => (setForm(blank), create.reset(), setOpen(true))}>
            <Plus className="h-4 w-4" /> Add customer
          </Button>
        }
      />
      <Card pad={false}>
        <ListBar>
          <ViewTabs views={[{ key: "", label: "All" }, { key: "active", label: "Active" }, { key: "prospect", label: "Prospects" }, { key: "inactive", label: "Inactive" }]} value={status} onChange={setStatus} />
          <div className="ml-auto w-full sm:w-72">
            <SearchBox value={q} onChange={setQ} placeholder="Search name or code" />
          </div>
        </ListBar>
        {list.isLoading ? (
          <Loading />
        ) : (
          <Table head={["Code", "Name", "Contact", R("Open quotes"), R("Open orders"), "Status"]} empty="No customers yet. Add your first one.">
            {(list.data ?? []).map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-panel-2" onClick={() => nav(`/customers/${c.id}`)}>
                <Td className="num text-muted">{c.code}</Td>
                <Td className="font-medium">{c.name}</Td>
                <Td className="text-muted">{c.email ?? c.phone ?? "—"}</Td>
                <Td right>{c.openQuotes}</Td>
                <Td right>{c.openOrders}</Td>
                <Td><Status value={c.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={open} title="Add customer" onClose={() => setOpen(false)}>
        <form onSubmit={(e) => (e.preventDefault(), create.mutate())} className="space-y-4">
          <CustomerFields form={form} setForm={setForm} fields={fields} />
          {!Object.keys(fields).length && <ErrorNote error={create.error} />}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>Save customer</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

type CustomerDetail = Customer & { contacts: Contact[]; quotes: QuoteSummary[]; salesOrders: SalesOrderSummary[] };

export function CustomerDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ["customer", id], queryFn: () => api<CustomerDetail>(`/customers/${id}`) });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(blank);
  const [contact, setContact] = useState({ name: "", title: "", email: "", phone: "" });
  const [addingContact, setAddingContact] = useState(false);
  const [tab, setTab] = useState<"quotes" | "orders" | "files">("quotes");
  const [fileCount, setFileCount] = useState<number | undefined>();
  const nav = useNavigate();
  const refresh = () => qc.invalidateQueries({ queryKey: ["customer", id] });
  const save = useMutation({
    mutationFn: () => api(`/customers/${id}`, "PATCH", toBody(form)),
    onSuccess: () => (refresh(), qc.invalidateQueries({ queryKey: ["customers"] }), setEditing(false)),
  });
  const addContact = useMutation({
    mutationFn: () => api(`/customers/${id}/contacts`, "POST", { ...contact, isPrimary: !(c.data?.contacts.length ?? 0) }),
    onSuccess: () => (refresh(), setContact({ name: "", title: "", email: "", phone: "" }), setAddingContact(false)),
  });
  const makePrimary = useMutation({ mutationFn: (cid: string) => api(`/contacts/${cid}`, "PATCH", { isPrimary: true }), onSuccess: refresh });
  const removeContact = useMutation({ mutationFn: (cid: string) => api(`/contacts/${cid}`, "DELETE"), onSuccess: refresh });

  if (c.error) return <ErrorNote error={c.error} />;
  if (!c.data) return <Loading />;
  const d = c.data;
  const startEdit = () => {
    setForm({
      name: d.name,
      code: d.code,
      status: d.status,
      email: d.email ?? "",
      phone: d.phone ?? "",
      website: d.website ?? "",
      paymentTermsDays: String(d.paymentTermsDays ?? 30),
      notes: d.notes ?? "",
    });
    save.reset();
    setEditing(true);
  };
  const onAddContact = (e: FormEvent) => (e.preventDefault(), addContact.mutate());
  const fields = save.error instanceof ApiError ? save.error.fields ?? {} : {};

  const won = d.quotes.filter((q) => q.status === "won").length;
  const decided = d.quotes.filter((q) => q.status === "won" || q.status === "lost").length;
  const openQuotes = d.quotes.filter((q) => q.status === "draft" || q.status === "sent");
  const openOrders = d.salesOrders.filter((o) => o.status === "confirmed" || o.status === "in_production" || o.status === "ready");
  const lifetime = d.salesOrders.filter((o) => o.status !== "cancelled").reduce((a, o) => a + o.totalPrice, 0);
  const primary = d.contacts.find((x) => x.isPrimary);

  return (
    <>
      <DetailTitle
        parent={{ to: "/customers", label: "Customers" }}
        title={d.name}
        badge={<Status value={d.status} />}
        sub={<><span className="num">{d.code}</span>{primary && <> · {primary.name}{primary.email && ` (${primary.email})`}</>}</>}
        actions={
          <>
            <Button onClick={startEdit}><Pencil className="h-4 w-4" /> Edit</Button>
            <ButtonLink to={`/quotes/new?customer=${d.id}`} variant="primary"><Plus className="h-4 w-4" /> New quote</ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
        <MetricCard label="Open quotes" value={openQuotes.length} tone="accent" note={`${money(openQuotes.reduce((a, q) => a + q.totalPrice, 0), 0)} quoted`} />
        <MetricCard label="Win rate" value={decided ? `${Math.round((won / decided) * 100)}%` : "—"} tone={decided && won / decided < 0.25 ? "warn" : "ok"} note={decided ? `${won} won of ${decided} decided` : "No quotes decided yet"} />
        <MetricCard label="Open orders" value={openOrders.length} tone="ok" note={`${money(openOrders.reduce((a, o) => a + o.totalPrice, 0), 0)} in backlog`} />
        <MetricCard label="Ordered to date" value={money(lifetime, 0)} tone="line" note={`${d.salesOrders.length} ${d.salesOrders.length === 1 ? "order" : "orders"}`} />
        <MetricCard label="Payment terms" value={`${d.paymentTermsDays} days`} tone="line" note="From invoice date" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className={recordCard}>
          <div className="text-[15px] font-medium">Customer {d.code}</div>
          <div className="mt-1 text-[26px] font-semibold leading-tight">{d.name}</div>
          <div className="mt-4 space-y-3">
            <InsetField label="E-mail">{d.email ? <a href={`mailto:${d.email}`} className="block truncate text-[15px] text-accent hover:underline">{d.email}</a> : <div className="text-[15px] text-muted">—</div>}</InsetField>
            <div className="grid grid-cols-2 gap-3">
              <InsetField label="Phone"><div className="truncate text-[15px]">{d.phone || "—"}</div></InsetField>
              <InsetField label="Website"><div className="truncate text-[15px]">{d.website || "—"}</div></InsetField>
            </div>
            {d.notes && <InsetField label="Notes"><div className="whitespace-pre-wrap text-sm leading-relaxed">{d.notes}</div></InsetField>}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <h3 className="font-semibold">Contacts</h3>
            {!addingContact && <Button variant="ghost" onClick={() => setAddingContact(true)}><Plus className="h-4 w-4" /> Add</Button>}
          </div>
          <ul className="mt-2 space-y-2">
            {d.contacts.map((ct) => (
              <li key={ct.id} className={cx("flex items-start gap-3 rounded-lg px-3 py-2 ring-1", ct.isPrimary ? "bg-accent-soft/50 ring-accent/40" : "ring-line")}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel-2 text-xs font-semibold">{ct.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">{ct.name} {ct.isPrimary && <span className="ml-1 text-xs font-normal text-accent">Primary</span>}</div>
                  {[ct.title, ct.email, ct.phone].some(Boolean) && <div className="truncate text-xs text-muted">{[ct.title, ct.email, ct.phone].filter(Boolean).join(" · ")}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {!ct.isPrimary && (
                    <button type="button" title="Make primary" aria-label={`Make ${ct.name} the primary contact`} onClick={() => makePrimary.mutate(ct.id)} className="rounded p-1 text-muted hover:text-accent"><Star className="h-4 w-4" /></button>
                  )}
                  <button type="button" title="Remove" aria-label={`Remove ${ct.name}`} onClick={() => removeContact.mutate(ct.id)} className="rounded p-1 text-muted hover:text-bad"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
          {d.contacts.length === 0 && !addingContact && <p className="py-2 text-sm text-muted">No contacts yet.</p>}
          {addingContact && (
            <form onSubmit={onAddContact} className="mt-3 grid gap-2 border-t border-line pt-3">
              <Input aria-label="Contact name" placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} required />
              <div className="grid grid-cols-2 gap-2">
                <Input aria-label="Title" placeholder="Title" value={contact.title} onChange={(e) => setContact({ ...contact, title: e.target.value })} />
                <Input aria-label="Phone" placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
              </div>
              <Input type="email" aria-label="E-mail" placeholder="E-mail" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              <ErrorNote error={addContact.error} />
              <div className="flex justify-end gap-2">
                <Button onClick={() => setAddingContact(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={addContact.isPending}>Save contact</Button>
              </div>
            </form>
          )}
        </section>

        <TabPanel
          title="Details"
          tabs={
            <PillTabs
              tabs={[
                { key: "quotes" as const, label: "Quotes", count: d.quotes.length },
                { key: "orders" as const, label: "Orders", count: d.salesOrders.length },
                { key: "files" as const, label: "Attachments", count: fileCount },
              ]}
              value={tab}
              onChange={setTab}
            />
          }
        >
          {tab === "quotes" && (
            <Table head={["Quote", "Date", R("Value"), "Status"]} empty="No quotes for this customer yet.">
              {d.quotes.map((q) => (
                <tr key={q.id} className="cursor-pointer hover:bg-panel-2" onClick={() => nav(`/quotes/${q.id}`)}>
                  <Td className="num font-medium">{q.number}{q.revision > 0 && <span className="text-muted"> r{q.revision}</span>}</Td>
                  <Td>{date(q.createdAt)}</Td>
                  <Td right>{money(q.totalPrice)}</Td>
                  <Td><Status value={q.status} /></Td>
                </tr>
              ))}
            </Table>
          )}
          {tab === "orders" && (
            <Table head={["Order", "Date", R("Value"), "Status"]} empty="No orders yet.">
              {d.salesOrders.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-panel-2" onClick={() => nav(`/sales-orders/${o.id}`)}>
                  <Td className="num font-medium">{o.number}</Td>
                  <Td>{date(o.orderDate)}</Td>
                  <Td right>{money(o.totalPrice)}</Td>
                  <Td><Status value={o.status} /></Td>
                </tr>
              ))}
            </Table>
          )}
          {tab === "files" && <FilesPanel entity="customer" entityId={d.id} onCount={setFileCount} height={420} />}
        </TabPanel>
      </div>
      <Modal open={editing} title="Edit customer" onClose={() => setEditing(false)}>
        <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-4">
          <CustomerFields form={form} setForm={setForm} fields={fields} />
          {!Object.keys(fields).length && <ErrorNote error={save.error} />}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
