import { z } from "zod";

/** Request bodies shared by the API (validation) and the web app (forms). */

const text = (max = 200) => z.string().trim().max(max);
const optText = (max = 2000) => z.string().trim().max(max).optional().nullable();
const money = z.coerce.number().min(0).max(1e10);
const hours = z.coerce.number().min(0).max(1e6);
const pct = z.coerce.number().min(-100).max(10000);
const qty = z.coerce.number().positive().max(1e9);
const id = z.uuid();

export const ROLES = [
  "owner",
  "admin",
  "estimator",
  "planner",
  "operator",
  "quality",
  "purchasing",
  "accounting",
  "viewer",
] as const;
export type Role = (typeof ROLES)[number];

export const signupSchema = z.object({
  orgName: text(120).min(2),
  name: text(120).min(1),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(10).max(200),
});

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});

export const address = z
  .object({
    line1: optText(200),
    line2: optText(200),
    city: optText(100),
    region: optText(100),
    postalCode: optText(30),
    country: optText(60),
  })
  .partial();

export const CUSTOMER_STATUSES = ["prospect", "active", "inactive"] as const;
export const customerSchema = z.object({
  code: text(30).min(1).optional(),
  name: text(200).min(1),
  status: z.enum(CUSTOMER_STATUSES).default("active"),
  email: z.email().optional().nullable().or(z.literal("")),
  phone: optText(50),
  website: optText(200),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  billingAddress: address.default({}),
  shippingAddress: address.default({}),
  notes: optText(5000),
});

export const contactSchema = z.object({
  name: text(120).min(1),
  title: optText(120),
  email: z.email().optional().nullable().or(z.literal("")),
  phone: optText(50),
  isPrimary: z.boolean().default(false),
});

export const WORK_CENTER_KINDS = ["machine", "labor", "outside"] as const;
/** What a running timer does when its planned time is reached. */
export const AT_PLANNED_TIME = ["continue", "stop", "complete"] as const;
export type AtPlannedTime = (typeof AT_PLANNED_TIME)[number];
export const workCenterSchema = z.object({
  code: text(30).min(1),
  name: text(120).min(1),
  kind: z.enum(WORK_CENTER_KINDS).default("machine"),
  hourlyRate: money,
  capacityHoursPerDay: hours.default(8),
  atPlannedTime: z.enum(AT_PLANNED_TIME).default("continue"),
  active: z.boolean().default(true),
});

export const ITEM_TYPES = ["manufactured", "purchased", "material", "service"] as const;
export const routingOperationSchema = z.object({
  workCenterId: id,
  description: optText(500),
  setupHours: hours.default(0),
  runHoursPerUnit: hours.default(0),
});
export const bomLineSchema = z.object({
  componentItemId: id,
  quantityPer: qty,
  scrapPct: pct.default(0),
});
export const itemSchema = z.object({
  partNumber: text(60).min(1),
  revision: text(20).default("A"),
  description: text(500).min(1),
  type: z.enum(ITEM_TYPES).default("manufactured"),
  uom: text(20).default("ea"),
  unitCost: money.default(0),
  salePrice: money.default(0),
  active: z.boolean().default(true),
  routing: z.array(routingOperationSchema).max(200).default([]),
  bom: z.array(bomLineSchema).max(500).default([]),
});

export const QUOTE_STATUSES = ["draft", "sent", "won", "lost", "expired", "cancelled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const quoteOperationSchema = z.object({
  workCenterId: id.optional().nullable(),
  description: optText(500),
  setupHours: hours.default(0),
  runHoursPerUnit: hours.default(0),
  /** Empty means "use the work center's hourly rate". */
  rate: money.optional().nullable(),
});
export const quoteMaterialSchema = z.object({
  kind: z.enum(["material", "service"]).default("material"),
  itemId: id.optional().nullable(),
  description: text(500).min(1),
  quantityPer: z.coerce.number().min(0).max(1e9).default(1),
  unitCost: money.default(0),
  scrapPct: pct.default(0),
  perLot: z.boolean().default(false),
});
export const quoteLineSchema = z.object({
  itemId: id.optional().nullable(),
  description: text(500).min(1),
  quantity: qty,
  markupPct: pct.default(25),
  unitPriceOverride: money.optional().nullable(),
  operations: z.array(quoteOperationSchema).max(100).default([]),
  materials: z.array(quoteMaterialSchema).max(100).default([]),
});
export const quoteSchema = z.object({
  customerId: id,
  contactId: id.optional().nullable(),
  validUntil: z.iso.date().optional().nullable(),
  leadTimeDays: z.coerce.number().int().min(0).max(3650).default(14),
  notes: optText(5000),
  terms: optText(5000),
  lines: z.array(quoteLineSchema).max(200).default([]),
});

export const convertQuoteSchema = z.object({
  customerPo: optText(60),
  /** Quote line ids to put on the order; empty means every line. */
  lineIds: z.array(id).default([]),
  dueDate: z.iso.date().optional().nullable(),
  /** Also create a job for every order line. */
  createJobs: z.boolean().default(true),
});

export const SALES_ORDER_STATUSES = [
  "draft",
  "confirmed",
  "in_production",
  "ready",
  "shipped",
  "closed",
  "cancelled",
] as const;

export const JOB_STATUSES = ["planned", "released", "in_progress", "complete", "closed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const OPERATION_STATUSES = ["pending", "ready", "running", "done"] as const;

export const jobStatusSchema = z.object({ status: z.enum(JOB_STATUSES) });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type WorkCenterInput = z.infer<typeof workCenterSchema>;
export type ItemInput = z.infer<typeof itemSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;
export type QuoteLineInput = z.infer<typeof quoteLineSchema>;
export type ConvertQuoteInput = z.infer<typeof convertQuoteSchema>;
