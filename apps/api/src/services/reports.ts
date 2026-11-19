/**
 * Reports: a fixed list of datasets (each a read-only, shop-scoped query with typed columns)
 * and saved reports that chart or tabulate one dataset. Grouping and totals happen in the
 * browser so a report can be reshaped instantly; datasets are capped at MAX_ROWS rows.
 */
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { reports, users } from "../db/schema.ts";
import { badRequest, notFound, type Ctx } from "../ctx.ts";

export const MAX_ROWS = 20000;
type ColType = "text" | "number" | "money" | "date";
interface Dataset {
  key: string;
  label: string;
  description: string;
  columns: { key: string; label: string; type: ColType }[];
  query: (orgId: string) => SQL;
}

const DATASETS: Dataset[] = [
  {
    key: "sales_lines",
    label: "Sales order lines",
    description: "Every line on every sales order: customer, part, quantity, price and the quoted cost.",
    columns: [
      { key: "order_number", label: "Order", type: "text" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "status", label: "Order status", type: "text" },
      { key: "order_date", label: "Order date", type: "date" },
      { key: "due_date", label: "Due date", type: "date" },
      { key: "part_number", label: "Part", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "unit_price", label: "Unit price", type: "money" },
      { key: "line_total", label: "Line total", type: "money" },
      { key: "quoted_cost", label: "Quoted cost", type: "money" },
      { key: "quantity_shipped", label: "Shipped", type: "number" },
    ],
    query: (org) => sql`
      select so.number as order_number, c.name as customer, so.status, so.order_date::text as order_date, l.due_date::text as due_date,
        coalesce(i.part_number, 'One-off') as part_number, l.description, l.quantity::float as quantity, l.unit_price::float as unit_price,
        round(l.quantity * l.unit_price, 2)::float as line_total,
        coalesce(ql.unit_cost * l.quantity, 0)::float as quoted_cost, l.quantity_shipped::float as quantity_shipped
      from sales_order_lines l join sales_orders so on so.id = l.sales_order_id join customers c on c.id = so.customer_id
      left join items i on i.id = l.item_id left join quote_lines ql on ql.id = l.quote_line_id
      where so.org_id = ${org} order by so.order_date desc`,
  },
  {
    key: "jobs",
    label: "Jobs",
    description: "Every job with its estimated and actual cost, revenue and margin.",
    columns: [
      { key: "job_number", label: "Job", type: "text" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "part_number", label: "Part", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "created", label: "Created", type: "date" },
      { key: "due_date", label: "Due date", type: "date" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "quantity_completed", label: "Completed", type: "number" },
      { key: "estimated_cost", label: "Estimated cost", type: "money" },
      { key: "actual_cost", label: "Actual cost", type: "money" },
      { key: "revenue", label: "Revenue", type: "money" },
      { key: "margin", label: "Margin so far (revenue − actual cost)", type: "money" },
    ],
    query: (org) => sql`
      select j.number as job_number, coalesce(c.name, 'Stock') as customer, coalesce(i.part_number, 'One-off') as part_number, j.status,
        j.created_at::date::text as created, j.due_date::text as due_date, j.quantity::float, j.quantity_completed::float,
        j.estimated_cost::float, j.actual_cost::float, coalesce(l.quantity * l.unit_price, 0)::float as revenue,
        (coalesce(l.quantity * l.unit_price, 0) - j.actual_cost)::float as margin
      from jobs j left join sales_order_lines l on l.id = j.sales_order_line_id left join sales_orders so on so.id = l.sales_order_id
      left join customers c on c.id = so.customer_id left join items i on i.id = j.item_id
      where j.org_id = ${org} order by j.created_at desc`,
  },
  {
    key: "quotes",
    label: "Quotes",
    description: "Every quote: customer, status, value, cost and margin, and how long it took to decide.",
    columns: [
      { key: "quote_number", label: "Quote", type: "text" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "created", label: "Created", type: "date" },
      { key: "total_price", label: "Quoted value", type: "money" },
      { key: "total_cost", label: "Quoted cost", type: "money" },
      { key: "margin_pct", label: "Margin %", type: "number" },
      { key: "days_to_decide", label: "Days to decide", type: "number" },
    ],
    query: (org) => sql`
      select q.number as quote_number, c.name as customer, q.status, q.created_at::date::text as created, q.total_price::float, q.total_cost::float,
        case when q.total_price > 0 then round(100 * (q.total_price - q.total_cost) / q.total_price, 1)::float else 0 end as margin_pct,
        case when q.decided_at is not null then extract(day from q.decided_at - q.created_at)::float end as days_to_decide
      from quotes q join customers c on c.id = q.customer_id where q.org_id = ${org} order by q.created_at desc`,
  },
  {
    key: "labor",
    label: "Labor and machine time",
    description: "Every timer run on the floor: who, which work center and job, hours, cost and parts.",
    columns: [
      { key: "day", label: "Date", type: "date" },
      { key: "person", label: "Person", type: "text" },
      { key: "work_center", label: "Work center", type: "text" },
      { key: "job_number", label: "Job", type: "text" },
      { key: "kind", label: "Type", type: "text" },
      { key: "hours", label: "Hours", type: "number" },
      { key: "cost", label: "Cost", type: "money" },
      { key: "good", label: "Good parts", type: "number" },
      { key: "scrap", label: "Scrap parts", type: "number" },
      { key: "scrap_reason", label: "Scrap reason", type: "text" },
    ],
    query: (org) => sql`
      select e.started_at::date::text as day, u.name as person, coalesce(w.name, 'No work center') as work_center, j.number as job_number, e.kind,
        round((extract(epoch from (coalesce(e.ended_at, now()) - e.started_at)) / 3600)::numeric, 3)::float as hours,
        round((extract(epoch from (coalesce(e.ended_at, now()) - e.started_at)) / 3600 * e.rate)::numeric, 2)::float as cost,
        e.quantity_good::float as good, e.quantity_scrap::float as scrap, e.scrap_reason
      from labor_entries e join users u on u.id = e.user_id join job_operations o on o.id = e.job_operation_id join jobs j on j.id = o.job_id
      left join work_centers w on w.id = o.work_center_id where e.org_id = ${org} order by e.started_at desc`,
  },
  {
    key: "inspection",
    label: "Inspection readings",
    description: "Every quality reading: job, balloon, piece, value, limits and pass or fail.",
    columns: [
      { key: "day", label: "Date", type: "date" },
      { key: "job_number", label: "Job", type: "text" },
      { key: "balloon", label: "Balloon", type: "number" },
      { key: "kind", label: "Feature", type: "text" },
      { key: "piece", label: "Piece", type: "number" },
      { key: "value", label: "Reading", type: "number" },
      { key: "nominal", label: "Target", type: "number" },
      { key: "result", label: "Result", type: "text" },
      { key: "person", label: "By", type: "text" },
    ],
    query: (org) => sql`
      select r.recorded_at::date::text as day, j.number as job_number, c.number as balloon, c.kind, r.piece, r.value::float, c.nominal::float,
        case when r.passed is false then 'Fail' when r.passed then 'Pass' else 'Not judged' end as result, u.name as person
      from inspection_results r join job_characteristics c on c.id = r.characteristic_id join jobs j on j.id = r.job_id left join users u on u.id = r.user_id
      where r.org_id = ${org} order by r.recorded_at desc`,
  },
  {
    key: "stock_moves",
    label: "Stock movements",
    description: "Every change to stock: receipts, picks, returns, remnants, counts and adjustments, with value.",
    columns: [
      { key: "day", label: "Date", type: "date" },
      { key: "part_number", label: "Item", type: "text" },
      { key: "kind", label: "Movement", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "value", label: "Value", type: "money" },
      { key: "job_number", label: "Job", type: "text" },
      { key: "tracked", label: "From stock", type: "text" },
    ],
    query: (org) => sql`
      select t.created_at::date::text as day, coalesce(i.part_number, 'Free text') as part_number, t.kind, t.quantity::float, t.value::float,
        j.number as job_number, case when t.lot_id is null then 'Untracked' else 'Yes' end as tracked
      from stock_transactions t left join items i on i.id = t.item_id left join jobs j on j.id = t.job_id
      where t.org_id = ${org} order by t.created_at desc`,
  },
  {
    key: "purchases",
    label: "Purchase order lines",
    description: "Everything ordered from vendors: what, when, how much, and what has arrived.",
    columns: [
      { key: "po_number", label: "Order", type: "text" },
      { key: "vendor", label: "Vendor", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "order_date", label: "Ordered", type: "date" },
      { key: "due_date", label: "Due", type: "date" },
      { key: "part_number", label: "Item", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "received", label: "Received", type: "number" },
      { key: "unit_cost", label: "Unit cost", type: "money" },
      { key: "line_total", label: "Line total", type: "money" },
    ],
    query: (org) => sql`
      select p.number as po_number, v.name as vendor, p.status, coalesce(p.order_date, p.created_at::date)::text as order_date, l.due_date::text as due_date,
        coalesce(i.part_number, 'Free text') as part_number, l.quantity::float, l.quantity_received::float as received, l.unit_cost::float,
        round(l.quantity * l.unit_cost, 2)::float as line_total
      from purchase_order_lines l join purchase_orders p on p.id = l.purchase_order_id join vendors v on v.id = p.vendor_id
      left join items i on i.id = l.item_id where l.org_id = ${org} order by p.created_at desc`,
  },
];

export function listDatasets() {
  return DATASETS.map(({ query: _q, ...d }) => d);
}

export async function datasetRows(db: Db, ctx: Ctx, key: string) {
  const d = DATASETS.find((x) => x.key === key);
  if (!d) throw notFound("Dataset");
  const res = await db.execute(sql`select * from (${d.query(ctx.orgId)}) as data limit ${MAX_ROWS + 1}`);
  const rows = res.rows.slice(0, MAX_ROWS);
  return { columns: d.columns, rows, truncated: res.rows.length > MAX_ROWS };
}

// ── Saved reports ───────────────────────────────────────────────────────────

const viewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  chart: z.enum(["table", "bar", "line", "area", "pie", "kpi", "scatter"]),
  values: z.array(z.object({ field: z.string().max(60), agg: z.enum(["sum", "avg", "count", "min", "max"]) })).max(8),
  groupBy: z.object({ field: z.string().max(60), bucket: z.enum(["day", "week", "month", "quarter", "year"]).nullish() }).nullish(),
  breakdown: z.string().max(60).nullish(),
  filters: z.array(z.object({ field: z.string().max(60), op: z.enum(["is", "is_not", "contains", "gt", "lt", "after", "before"]), value: z.string().max(200) })).max(20).default([]),
  hidden: z.array(z.string().max(60)).max(60).default([]),
  sort: z.enum(["label", "value_desc", "value_asc"]).default("label"),
  limit: z.number().int().min(1).max(500).nullish(),
  stacked: z.boolean().default(false),
});
export const reportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  dataset: z.string().max(40),
  config: z.object({ views: z.array(viewSchema).min(1).max(12) }),
  starred: z.boolean().default(false),
  pinned: z.boolean().default(false),
});
export type ReportInput = z.infer<typeof reportSchema>;

function checkFields(input: ReportInput) {
  const d = DATASETS.find((x) => x.key === input.dataset);
  if (!d) throw badRequest("Unknown dataset");
  const keys = new Set(d.columns.map((c) => c.key));
  for (const v of input.config.views) {
    const used = [...v.values.map((x) => x.field), v.groupBy?.field, v.breakdown, ...v.filters.map((f) => f.field)].filter((x): x is string => !!x && x !== "*");
    const bad = used.find((f) => !keys.has(f));
    if (bad) throw badRequest(`"${bad}" is not a column of ${d.label}`);
  }
}

export async function listReports(db: Db, ctx: Ctx) {
  return db
    .select({ id: reports.id, name: reports.name, dataset: reports.dataset, starred: reports.starred, pinned: reports.pinned, updatedAt: reports.updatedAt, updatedBy: users.name })
    .from(reports)
    .leftJoin(users, eq(users.id, reports.updatedBy))
    .where(eq(reports.orgId, ctx.orgId))
    .orderBy(desc(reports.starred), desc(reports.updatedAt));
}

export async function getReport(db: Db, ctx: Ctx, id: string) {
  const [r] = await db.select().from(reports).where(and(eq(reports.orgId, ctx.orgId), eq(reports.id, id)));
  if (!r) throw notFound("Report");
  return r;
}

export async function saveReport(db: Db, ctx: Ctx, input: ReportInput, id?: string) {
  if (ctx.role === "viewer") throw badRequest("Your role can read reports but not save them");
  checkFields(input);
  if (id) {
    const [r] = await db.update(reports).set({ ...input, updatedAt: new Date(), updatedBy: ctx.userId }).where(and(eq(reports.orgId, ctx.orgId), eq(reports.id, id))).returning();
    if (!r) throw notFound("Report");
    return r;
  }
  const [r] = await db.insert(reports).values({ ...input, orgId: ctx.orgId, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
  return r!;
}

export async function deleteReport(db: Db, ctx: Ctx, id: string) {
  if (ctx.role === "viewer") throw badRequest("Your role can read reports but not delete them");
  const [r] = await db.delete(reports).where(and(eq(reports.orgId, ctx.orgId), eq(reports.id, id))).returning({ id: reports.id });
  if (!r) throw notFound("Report");
}

export async function pinnedReports(db: Db, ctx: Ctx) {
  return db.select().from(reports).where(and(eq(reports.orgId, ctx.orgId), eq(reports.pinned, true))).orderBy(desc(reports.updatedAt)).limit(6);
}

export const flagsSchema = z.object({ starred: z.boolean().optional(), pinned: z.boolean().optional() });

/** Star or pin without touching the report's views (used from the list). */
export async function setFlags(db: Db, ctx: Ctx, id: string, input: z.infer<typeof flagsSchema>) {
  if (ctx.role === "viewer") throw badRequest("Your role can read reports but not change them");
  const [r] = await db.update(reports).set({ ...input, updatedAt: new Date(), updatedBy: ctx.userId }).where(and(eq(reports.orgId, ctx.orgId), eq(reports.id, id))).returning({ id: reports.id });
  if (!r) throw notFound("Report");
  return r;
}
