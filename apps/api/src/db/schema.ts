import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Phase-1 schema. Conventions: see docs/DATABASE.md. Numeric columns use mode "number":
 * values fit well inside double precision at these scales, and every stored cost/price
 * is rounded by packages/shared/src/pricing.ts before saving.
 */

const money = (name: string) => numeric(name, { precision: 14, scale: 4, mode: "number" });
const qty = (name: string) => numeric(name, { precision: 14, scale: 4, mode: "number" });
const hrs = (name: string) => numeric(name, { precision: 10, scale: 4, mode: "number" });
const pct = (name: string) => numeric(name, { precision: 9, scale: 4, mode: "number" });

const pk = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const orgRef = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });
const userRef = (name: string) => uuid(name).references(() => users.id, { onDelete: "set null" });

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);

export type Address = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

// ── Platform ────────────────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: pk(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  currency: text("currency").notNull().default("USD"),
  timezone: text("timezone").notNull().default("UTC"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
});

export const users = pgTable("users", {
  id: pk(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: created(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: orgRef(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
  },
  (t) => [index("sessions_user").on(t.userId)],
);

export const numberSequences = pgTable(
  "number_sequences",
  {
    id: pk(),
    orgId: orgRef(),
    kind: text("kind").notNull(),
    prefix: text("prefix").notNull(),
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => [uniqueIndex("number_sequences_org_kind").on(t.orgId, t.kind)],
);

export const events = pgTable(
  "events",
  {
    id: pk(),
    orgId: orgRef(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    userId: userRef("user_id"),
    createdAt: created(),
  },
  (t) => [index("events_entity").on(t.orgId, t.entity, t.entityId)],
);

// ── CRM ─────────────────────────────────────────────────────────────────────

export const customers = pgTable(
  "customers",
  {
    id: pk(),
    orgId: orgRef(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    billingAddress: jsonb("billing_address").$type<Address>().notNull().default({}),
    shippingAddress: jsonb("shipping_address").$type<Address>().notNull().default({}),
    notes: text("notes"),
    createdAt: created(),
    updatedAt: updated(),
    createdBy: userRef("created_by"),
    updatedBy: userRef("updated_by"),
  },
  (t) => [
    uniqueIndex("customers_org_code").on(t.orgId, t.code),
    index("customers_org_name").on(t.orgId, t.name),
    check("customers_status", inList("status", ["prospect", "active", "inactive"])),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: pk(),
    orgId: orgRef(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("contacts_customer").on(t.orgId, t.customerId)],
);

// ── Resources, items, BOM, routing ───────────────────────────────────────────

export const workCenters = pgTable(
  "work_centers",
  {
    id: pk(),
    orgId: orgRef(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("machine"),
    hourlyRate: money("hourly_rate").notNull().default(0),
    capacityHoursPerDay: hrs("capacity_hours_per_day").notNull().default(8),
    /** When a timer reaches the planned time: keep running, stop the timer, or finish the step. */
    atPlannedTime: text("at_planned_time").notNull().default("continue"),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("work_centers_org_code").on(t.orgId, t.code),
    check("work_centers_kind", inList("kind", ["machine", "labor", "outside"])),
    check("work_centers_at_planned_time", inList("at_planned_time", ["continue", "stop", "complete"])),
  ],
);

export const items = pgTable(
  "items",
  {
    id: pk(),
    orgId: orgRef(),
    partNumber: text("part_number").notNull(),
    revision: text("revision").notNull().default("A"),
    description: text("description").notNull(),
    type: text("type").notNull().default("manufactured"),
    uom: text("uom").notNull().default("ea"),
    unitCost: money("unit_cost").notNull().default(0),
    salePrice: money("sale_price").notNull().default(0),
    /** Stock level that should trigger a purchase (or a make-to-stock job); null = not watched. */
    reorderPoint: qty("reorder_point"),
    /** Usual quantity to order when stock falls to the reorder point. */
    reorderQuantity: qty("reorder_quantity"),
    /** Packing size of one part (its bounding box), mm, and its weight, kg. */
    packL: qty("pack_l"),
    packW: qty("pack_w"),
    packH: qty("pack_h"),
    packWeight: qty("pack_weight"),
    /** Must ship this side up. */
    packUpright: boolean("pack_upright").notNull().default(false),
    /** Parts that nest into each other: height each extra part adds to a stack, mm. */
    packNestPitch: qty("pack_nest_pitch"),
    /** Last packing study settings and the chosen packing spec (see packages/shared/src/packing.ts). */
    packSettings: jsonb("pack_settings").$type<Record<string, unknown>>(),
    packSpec: jsonb("pack_spec").$type<Record<string, unknown>>(),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
    createdBy: userRef("created_by"),
    updatedBy: userRef("updated_by"),
  },
  (t) => [
    uniqueIndex("items_org_part_rev").on(t.orgId, t.partNumber, t.revision),
    check("items_type", inList("type", ["manufactured", "purchased", "material", "service"])),
  ],
);

export const routingOperations = pgTable(
  "routing_operations",
  {
    id: pk(),
    orgId: orgRef(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    workCenterId: uuid("work_center_id")
      .notNull()
      .references(() => workCenters.id),
    description: text("description"),
    setupHours: hrs("setup_hours").notNull().default(0),
    runHoursPerUnit: hrs("run_hours_per_unit").notNull().default(0),
  },
  (t) => [index("routing_item").on(t.orgId, t.itemId)],
);

export const bomLines = pgTable(
  "bom_lines",
  {
    id: pk(),
    orgId: orgRef(),
    parentItemId: uuid("parent_item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    componentItemId: uuid("component_item_id")
      .notNull()
      .references(() => items.id),
    sequence: integer("sequence").notNull(),
    quantityPer: qty("quantity_per").notNull(),
    scrapPct: pct("scrap_pct").notNull().default(0),
  },
  (t) => [
    index("bom_parent").on(t.orgId, t.parentItemId),
    check("bom_not_self", sql`parent_item_id <> component_item_id`),
  ],
);

// ── Quoting ─────────────────────────────────────────────────────────────────

export const quotes = pgTable(
  "quotes",
  {
    id: pk(),
    orgId: orgRef(),
    number: text("number").notNull(),
    revision: integer("revision").notNull().default(0),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    status: text("status").notNull().default("draft"),
    validUntil: date("valid_until"),
    leadTimeDays: integer("lead_time_days").notNull().default(14),
    notes: text("notes"),
    terms: text("terms"),
    totalPrice: money("total_price").notNull().default(0),
    totalCost: money("total_cost").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
    createdBy: userRef("created_by"),
    updatedBy: userRef("updated_by"),
  },
  (t) => [
    uniqueIndex("quotes_org_number_rev").on(t.orgId, t.number, t.revision),
    index("quotes_org_status").on(t.orgId, t.status),
    index("quotes_org_customer").on(t.orgId, t.customerId),
    check("quotes_status", inList("status", ["draft", "sent", "won", "lost", "expired", "cancelled"])),
  ],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: pk(),
    orgId: orgRef(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    itemId: uuid("item_id").references(() => items.id),
    description: text("description").notNull(),
    quantity: qty("quantity").notNull(),
    markupPct: pct("markup_pct").notNull().default(25),
    unitPriceOverride: money("unit_price_override"),
    unitCost: money("unit_cost").notNull().default(0),
    unitPrice: money("unit_price").notNull().default(0),
    totalPrice: money("total_price").notNull().default(0),
    totalCost: money("total_cost").notNull().default(0),
    totalHours: hrs("total_hours").notNull().default(0),
  },
  (t) => [index("quote_lines_quote").on(t.orgId, t.quoteId)],
);

export const quoteLineOperations = pgTable(
  "quote_line_operations",
  {
    id: pk(),
    orgId: orgRef(),
    quoteLineId: uuid("quote_line_id")
      .notNull()
      .references(() => quoteLines.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    workCenterId: uuid("work_center_id").references(() => workCenters.id),
    description: text("description"),
    setupHours: hrs("setup_hours").notNull().default(0),
    runHoursPerUnit: hrs("run_hours_per_unit").notNull().default(0),
    rate: money("rate").notNull().default(0),
    cost: money("cost").notNull().default(0),
  },
  (t) => [index("qlo_line").on(t.orgId, t.quoteLineId)],
);

export const quoteLineMaterials = pgTable(
  "quote_line_materials",
  {
    id: pk(),
    orgId: orgRef(),
    quoteLineId: uuid("quote_line_id")
      .notNull()
      .references(() => quoteLines.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull().default("material"),
    itemId: uuid("item_id").references(() => items.id),
    description: text("description").notNull(),
    quantityPer: qty("quantity_per").notNull().default(1),
    unitCost: money("unit_cost").notNull().default(0),
    scrapPct: pct("scrap_pct").notNull().default(0),
    perLot: boolean("per_lot").notNull().default(false),
    cost: money("cost").notNull().default(0),
  },
  (t) => [
    index("qlm_line").on(t.orgId, t.quoteLineId),
    check("qlm_kind", inList("kind", ["material", "service"])),
  ],
);

// ── Sales orders ────────────────────────────────────────────────────────────

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: pk(),
    orgId: orgRef(),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    quoteId: uuid("quote_id").references(() => quotes.id),
    customerPo: text("customer_po"),
    status: text("status").notNull().default("confirmed"),
    orderDate: date("order_date").notNull().defaultNow(),
    shipTo: jsonb("ship_to").$type<Address>().notNull().default({}),
    notes: text("notes"),
    totalPrice: money("total_price").notNull().default(0),
    createdAt: created(),
    updatedAt: updated(),
    createdBy: userRef("created_by"),
  },
  (t) => [
    uniqueIndex("sales_orders_org_number").on(t.orgId, t.number),
    index("sales_orders_org_status").on(t.orgId, t.status),
    check(
      "sales_orders_status",
      inList("status", ["draft", "confirmed", "in_production", "shipped", "closed", "cancelled"]),
    ),
  ],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: pk(),
    orgId: orgRef(),
    salesOrderId: uuid("sales_order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    quoteLineId: uuid("quote_line_id").references(() => quoteLines.id),
    itemId: uuid("item_id").references(() => items.id),
    description: text("description").notNull(),
    quantity: qty("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    dueDate: date("due_date"),
    quantityShipped: qty("quantity_shipped").notNull().default(0),
  },
  (t) => [index("sol_order").on(t.orgId, t.salesOrderId)],
);

// ── Jobs ────────────────────────────────────────────────────────────────────

export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    orgId: orgRef(),
    number: text("number").notNull(),
    salesOrderLineId: uuid("sales_order_line_id").references(() => salesOrderLines.id),
    /** For a job that makes a piece of an assembly: the assembly's job, and the material line it supplies. */
    parentJobId: uuid("parent_job_id").references((): AnyPgColumn => jobs.id, { onDelete: "cascade" }),
    parentMaterialId: uuid("parent_material_id"),
    itemId: uuid("item_id").references(() => items.id),
    description: text("description").notNull(),
    quantity: qty("quantity").notNull(),
    quantityCompleted: qty("quantity_completed").notNull().default(0),
    dueDate: date("due_date"),
    priority: integer("priority").notNull().default(50),
    status: text("status").notNull().default("planned"),
    notes: text("notes"),
    estimatedCost: money("estimated_cost").notNull().default(0),
    actualCost: money("actual_cost").notNull().default(0),
    createdAt: created(),
    updatedAt: updated(),
    createdBy: userRef("created_by"),
  },
  (t) => [
    uniqueIndex("jobs_org_number").on(t.orgId, t.number),
    index("jobs_org_status").on(t.orgId, t.status),
    check(
      "jobs_status",
      inList("status", ["planned", "released", "in_progress", "complete", "closed", "cancelled"]),
    ),
  ],
);

export const jobOperations = pgTable(
  "job_operations",
  {
    id: pk(),
    orgId: orgRef(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    workCenterId: uuid("work_center_id").references(() => workCenters.id),
    description: text("description"),
    setupHours: hrs("setup_hours").notNull().default(0),
    runHoursPerUnit: hrs("run_hours_per_unit").notNull().default(0),
    rate: money("rate").notNull().default(0),
    estimatedCost: money("estimated_cost").notNull().default(0),
    actualHours: hrs("actual_hours").notNull().default(0),
    actualCost: money("actual_cost").notNull().default(0),
    status: text("status").notNull().default("pending"),
    quantityGood: qty("quantity_good").notNull().default(0),
    quantityScrap: qty("quantity_scrap").notNull().default(0),
    /** Parts sent back for rework at this operation (they are neither good nor scrap yet). */
    quantityRework: qty("quantity_rework").notNull().default(0),
  },
  (t) => [
    index("job_ops_job").on(t.orgId, t.jobId),
    index("job_ops_wc").on(t.orgId, t.workCenterId, t.status),
    check("job_ops_status", inList("status", ["pending", "ready", "running", "done"])),
  ],
);

export const jobMaterials = pgTable(
  "job_materials",
  {
    id: pk(),
    orgId: orgRef(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull().default("material"),
    itemId: uuid("item_id").references(() => items.id),
    description: text("description").notNull(),
    quantityRequired: qty("quantity_required").notNull(),
    unitCost: money("unit_cost").notNull().default(0),
    estimatedCost: money("estimated_cost").notNull().default(0),
    quantityIssued: qty("quantity_issued").notNull().default(0),
    /** Cost of what was issued: lot cost for stock drawn from lots, the line's unit cost otherwise. */
    issuedCost: money("issued_cost").notNull().default(0),
  },
  (t) => [index("job_mats_job").on(t.orgId, t.jobId)],
);

// ── Files (drawings, CAD, photos, certificates) ─────────────────────────────

export const attachments = pgTable(
  "attachments",
  {
    id: pk(),
    orgId: orgRef(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    /** Light GLB made once from a CAD upload: null (not needed), pending, ready or failed. */
    previewStatus: text("preview_status"),
    previewError: text("preview_error"),
    createdBy: userRef("created_by"),
    createdAt: created(),
  },
  (t) => [
    index("attachments_entity").on(t.orgId, t.entity, t.entityId),
    check("attachments_entity_kind", inList("entity", ["item", "job", "quote", "customer", "sales_order", "stock_lot"])),
  ],
);

// ── Shop floor labor ────────────────────────────────────────────────────────

export const laborEntries = pgTable(
  "labor_entries",
  {
    id: pk(),
    orgId: orgRef(),
    jobOperationId: uuid("job_operation_id")
      .notNull()
      .references(() => jobOperations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull().default("run"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    quantityGood: qty("quantity_good").notNull().default(0),
    quantityScrap: qty("quantity_scrap").notNull().default(0),
    scrapReason: text("scrap_reason"),
    rate: money("rate").notNull().default(0),
    note: text("note"),
  },
  (t) => [
    index("labor_op").on(t.orgId, t.jobOperationId),
    index("labor_open").on(t.orgId, t.userId, t.endedAt),
    check("labor_kind", inList("kind", ["setup", "run", "labor"])),
  ],
);

// ── Job chat and alerts ─────────────────────────────────────────────────────

/** Messages about a job between the floor and the office; an alert flags a problem with a reason. */
export const jobMessages = pgTable(
  "job_messages",
  {
    id: pk(),
    orgId: orgRef(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: userRef("user_id"),
    kind: text("kind").notNull().default("message"),
    reason: text("reason"),
    body: text("body"),
    attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [index("job_messages_job").on(t.orgId, t.jobId, t.createdAt), check("job_messages_kind", inList("kind", ["message", "alert"]))],
);

// ── Quality: inspection plans and measurements ──────────────────────────────

/**
 * A numbered balloon on a part's drawing: one thing to measure or check. Linked to the routing
 * step by sequence (routing rows are rewritten on every save, so ids would not survive).
 */
export const inspectionCharacteristics = pgTable(
  "inspection_characteristics",
  {
    id: pk(),
    orgId: orgRef(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    kind: text("kind").notNull().default("length"),
    /** Drawing the balloon sits on; null once that file is deleted (the check itself stays). */
    attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "set null" }),
    page: integer("page").notNull().default(1),
    /** Balloon position as a fraction (0–1) of the page width and height. */
    x: numeric("x", { precision: 7, scale: 6, mode: "number" }),
    y: numeric("y", { precision: 7, scale: 6, mode: "number" }),
    nominal: numeric("nominal", { precision: 14, scale: 6, mode: "number" }),
    tolPlus: numeric("tol_plus", { precision: 14, scale: 6, mode: "number" }),
    tolMinus: numeric("tol_minus", { precision: 14, scale: 6, mode: "number" }),
    unit: text("unit").notNull().default("mm"),
    datums: text("datums"),
    requirement: text("requirement"),
    operationSeq: integer("operation_seq"),
    sampling: text("sampling").notNull().default("first"),
    everyN: integer("every_n"),
    gauge: text("gauge"),
    critical: boolean("critical").notNull().default(false),
  },
  (t) => [
    uniqueIndex("insp_char_item_number").on(t.itemId, t.number),
    index("insp_char_item").on(t.orgId, t.itemId),
    check("insp_char_sampling", inList("sampling", ["first", "every_n", "all"])),
  ],
);

/** The plan copied onto a job when it is made, so later edits to the part do not rewrite history. */
export const jobCharacteristics = pgTable(
  "job_characteristics",
  {
    id: pk(),
    orgId: orgRef(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    kind: text("kind").notNull(),
    attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "set null" }),
    page: integer("page").notNull().default(1),
    x: numeric("x", { precision: 7, scale: 6, mode: "number" }),
    y: numeric("y", { precision: 7, scale: 6, mode: "number" }),
    nominal: numeric("nominal", { precision: 14, scale: 6, mode: "number" }),
    tolPlus: numeric("tol_plus", { precision: 14, scale: 6, mode: "number" }),
    tolMinus: numeric("tol_minus", { precision: 14, scale: 6, mode: "number" }),
    unit: text("unit").notNull().default("mm"),
    datums: text("datums"),
    requirement: text("requirement"),
    operationSeq: integer("operation_seq"),
    sampling: text("sampling").notNull().default("first"),
    everyN: integer("every_n"),
    gauge: text("gauge"),
    critical: boolean("critical").notNull().default(false),
  },
  (t) => [uniqueIndex("job_char_job_number").on(t.jobId, t.number)],
);

/** One reading (or pass/fail) of one characteristic on one piece of a job. */
export const inspectionResults = pgTable(
  "inspection_results",
  {
    id: pk(),
    orgId: orgRef(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    characteristicId: uuid("characteristic_id")
      .notNull()
      .references(() => jobCharacteristics.id, { onDelete: "cascade" }),
    piece: integer("piece").notNull(),
    value: numeric("value", { precision: 14, scale: 6, mode: "number" }),
    /** For notes: did the piece meet the requirement. For numbers: worked out from the limits. */
    passed: boolean("passed"),
    gauge: text("gauge"),
    userId: userRef("user_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("insp_result_piece").on(t.characteristicId, t.piece), index("insp_result_job").on(t.orgId, t.jobId)],
);

// ── Inventory: locations, lots and the stock ledger ─────────────────────────

export const stockLocations = pgTable(
  "stock_locations",
  {
    id: pk(),
    orgId: orgRef(),
    code: text("code").notNull(),
    name: text("name"),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
  },
  (t) => [uniqueIndex("stock_locations_org_code").on(t.orgId, t.code)],
);

/**
 * A quantity of one item at one location that arrived together: a lot. Quantity is in the item's
 * unit of measure and is a cache of the sum of the lot's ledger rows. A remnant is a lot cut from
 * another lot on the floor; it keeps the parent's cost and certificate.
 */
export const stockLots = pgTable(
  "stock_lots",
  {
    id: pk(),
    orgId: orgRef(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => stockLocations.id),
    lotNumber: text("lot_number").notNull(),
    /** Free-text size, e.g. "48 x 120" or "36 in"; a label only. */
    dimensions: text("dimensions"),
    heatNumber: text("heat_number"),
    supplier: text("supplier"),
    quantity: qty("quantity").notNull().default(0),
    unitCost: money("unit_cost").notNull().default(0),
    remnant: boolean("remnant").notNull().default(false),
    parentLotId: uuid("parent_lot_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: userRef("created_by"),
  },
  (t) => [
    index("stock_lots_item").on(t.orgId, t.itemId),
    uniqueIndex("stock_lots_org_number").on(t.orgId, t.lotNumber),
    check("stock_lots_not_negative", sql`quantity >= 0`),
  ],
);

/** The stock ledger: every change to stock, signed, with its value at the lot's cost. */
export const stockTransactions = pgTable(
  "stock_transactions",
  {
    id: pk(),
    orgId: orgRef(),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    lotId: uuid("lot_id").references(() => stockLots.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    quantity: qty("quantity").notNull(),
    unitCost: money("unit_cost").notNull().default(0),
    value: money("value").notNull().default(0),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    jobMaterialId: uuid("job_material_id").references(() => jobMaterials.id, { onDelete: "set null" }),
    /** Where it came from outside a job, e.g. a purchase order receipt (filled by Purchasing). */
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    note: text("note"),
    userId: userRef("user_id"),
    createdAt: created(),
  },
  (t) => [
    index("stock_tx_item").on(t.orgId, t.itemId, t.createdAt),
    index("stock_tx_lot").on(t.lotId),
    index("stock_tx_job_material").on(t.jobMaterialId),
    check("stock_tx_kind", inList("kind", ["receive", "consume", "return", "remnant", "adjust", "count", "move_out", "move_in"])),
  ],
);

// ── Purchasing: vendors, who sells what, purchase orders ────────────────────

export const vendors = pgTable(
  "vendors",
  {
    id: pk(),
    orgId: orgRef(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: jsonb("address").$type<Address>().notNull().default({}),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
  },
  (t) => [uniqueIndex("vendors_org_name").on(t.orgId, t.name)],
);

/** A vendor that sells an item: lead time, price and minimum order. One per item is primary. */
export const itemVendors = pgTable(
  "item_vendors",
  {
    id: pk(),
    orgId: orgRef(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    leadDays: integer("lead_days").notNull().default(7),
    unitCost: money("unit_cost").notNull().default(0),
    minOrder: qty("min_order"),
    vendorPartNumber: text("vendor_part_number"),
  },
  (t) => [
    uniqueIndex("item_vendors_pair").on(t.itemId, t.vendorId),
    uniqueIndex("item_vendors_one_primary").on(t.itemId).where(sql`is_primary`),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: pk(),
    orgId: orgRef(),
    number: text("number").notNull(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    /** draft → sent → partial → received; cancelled only while nothing is received. */
    status: text("status").notNull().default("draft"),
    orderDate: date("order_date"),
    notes: text("notes"),
    total: money("total").notNull().default(0),
    createdAt: created(),
    updatedAt: updated(),
    createdBy: userRef("created_by"),
  },
  (t) => [
    uniqueIndex("po_org_number").on(t.orgId, t.number),
    check("po_status", inList("status", ["draft", "sent", "partial", "received", "cancelled"])),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: pk(),
    orgId: orgRef(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    itemId: uuid("item_id").references(() => items.id),
    description: text("description").notNull(),
    quantity: qty("quantity").notNull(),
    unitCost: money("unit_cost").notNull().default(0),
    dueDate: date("due_date"),
    quantityReceived: qty("quantity_received").notNull().default(0),
    /** For outside services bought for a job (seam for later; not used yet). */
    jobMaterialId: uuid("job_material_id").references(() => jobMaterials.id, { onDelete: "set null" }),
  },
  (t) => [index("po_lines_po").on(t.purchaseOrderId), index("po_lines_item").on(t.orgId, t.itemId)],
);

// ── Reports ─────────────────────────────────────────────────────────────────

/** A saved report: one dataset and one or more views (chart or table settings). */
export const reports = pgTable(
  "reports",
  {
    id: pk(),
    orgId: orgRef(),
    name: text("name").notNull(),
    dataset: text("dataset").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    starred: boolean("starred").notNull().default(false),
    /** Shown on the home dashboard. */
    pinned: boolean("pinned").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
    createdBy: userRef("created_by"),
    updatedBy: userRef("updated_by"),
  },
  (t) => [index("reports_org").on(t.orgId, t.updatedAt)],
);

// ── Packaging ───────────────────────────────────────────────────────────────

/** The shop's packaging library: cartons, totes, crates, pallets and trucks or containers. */
export const packAssets = pgTable(
  "pack_assets",
  {
    id: pk(),
    orgId: orgRef(),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Inside size for containers and vehicles; footprint and deck height for pallets. mm */
    l: qty("l").notNull(),
    w: qty("w").notNull(),
    h: qty("h").notNull(),
    wall: qty("wall").notNull().default(0),
    /** kg */
    tare: qty("tare").notNull().default(0),
    /** kg of load (containers, pallets) or payload (vehicles); 0 = no limit */
    maxLoad: qty("max_load").notNull().default(0),
    /** pallets: tallest loaded height, deck included, mm */
    maxHeight: qty("max_height").notNull().default(0),
    cost: money("cost").notNull().default(0),
    returnable: boolean("returnable").notNull().default(false),
    tripCost: money("trip_cost").notNull().default(0),
    lifeTrips: integer("life_trips").notNull().default(1),
    /** cartons: board grade key */
    grade: text("grade"),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("pack_assets_org_code").on(t.orgId, t.code),
    check("pack_assets_kind", inList("kind", ["carton", "tote", "crate", "pallet", "vehicle"])),
  ],
);
