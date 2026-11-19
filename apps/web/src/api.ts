export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T = unknown>(path: string, method: Method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message ?? `Request failed (${res.status})`, data?.error?.fields);
  }
  return data as T;
}

export const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

// ── Response shapes used by the pages ───────────────────────────────────────

export interface Me {
  user: { id: string; name: string; email: string };
  org: { id: string; name: string; currency: string };
  role: string;
}
export interface Customer {
  id: string;
  code: string;
  name: string;
  status: string;
  email: string | null;
  phone: string | null;
  website?: string | null;
  paymentTermsDays?: number;
  notes?: string | null;
  openQuotes?: number;
  openOrders?: number;
}
export interface Contact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}
export interface WorkCenter {
  id: string;
  code: string;
  name: string;
  kind: string;
  hourlyRate: number;
  capacityHoursPerDay: number;
  active: boolean;
}
export interface Item {
  id: string;
  partNumber: string;
  revision: string;
  description: string;
  type: string;
  uom: string;
  unitCost: number;
  salePrice: number;
  active: boolean;
}
export interface ItemDetail extends Item {
  routing: { id: string; workCenterId: string; workCenterCode: string; rate: number; description: string | null; setupHours: number; runHoursPerUnit: number }[];
  bom: { id: string; componentItemId: string; partNumber: string; description: string; unitCost: number; type: string; quantityPer: number; scrapPct: number }[];
}
export interface QuoteSummary {
  id: string;
  number: string;
  revision: number;
  status: string;
  customerId: string;
  customerName: string;
  totalPrice: number;
  totalCost: number;
  validUntil: string | null;
  createdAt: string;
}
export interface QuoteDetail {
  id: string;
  number: string;
  revision: number;
  status: string;
  customerId: string;
  customerName: string;
  contactId: string | null;
  validUntil: string | null;
  leadTimeDays: number;
  notes: string | null;
  terms: string | null;
  totalPrice: number;
  totalCost: number;
  createdAt: string;
  sentAt: string | null;
  decidedAt: string | null;
  salesOrders: { id: string; number: string; status: string }[];
  lines: {
    id: string;
    itemId: string | null;
    description: string;
    quantity: number;
    markupPct: number;
    unitPriceOverride: number | null;
    unitPrice: number;
    totalPrice: number;
    operations: { workCenterId: string | null; description: string | null; setupHours: number; runHoursPerUnit: number; rate: number }[];
    materials: { kind: "material" | "service"; itemId: string | null; description: string; quantityPer: number; unitCost: number; scrapPct: number; perLot: boolean }[];
  }[];
}
export interface SalesOrderSummary {
  id: string;
  number: string;
  status: string;
  customerName: string;
  customerPo: string | null;
  orderDate: string;
  totalPrice: number;
  dueDate: string | null;
}
export interface SalesOrderDetail extends SalesOrderSummary {
  customerId: string;
  quoteId: string | null;
  quoteNumber: string | null;
  notes: string | null;
  createdAt: string;
  log: { id: string; entity: string; action: string; data: Record<string, unknown>; createdAt: string; userName: string | null; jobNumber: string | null }[];
  lines: {
    id: string;
    lineNo: number;
    itemId: string | null;
    partNumber: string | null;
    revision: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
    dueDate: string | null;
    quantityShipped: number;
    jobs: { id: string; number: string; status: string; quantity: number; quantityCompleted: number }[];
  }[];
}
export interface JobSummary {
  id: string;
  number: string;
  description: string;
  quantity: number;
  quantityCompleted: number;
  dueDate: string | null;
  priority: number;
  status: string;
  estimatedCost: number;
  actualCost: number;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  customerName: string | null;
  operationsDone: number;
  operationsTotal: number;
}
export interface JobDetail extends Omit<JobSummary, "operationsDone" | "operationsTotal"> {
  itemId: string | null;
  notes: string | null;
  createdAt: string;
  costs: { laborEstimate: number; laborActual: number; materialEstimate: number; materialActual: number };
  log: { id: string; action: string; data: Record<string, unknown>; createdAt: string; userName: string | null }[];
  customerId: string | null;
  customerPo: string | null;
  part: { partNumber: string; revision: string; name: string; type: string; uom: string } | null;
  revenue: number | null;
  operations: {
    id: string;
    sequence: number;
    workCenterCode: string | null;
    workCenterName: string | null;
    description: string | null;
    setupHours: number;
    runHoursPerUnit: number;
    rate: number;
    estimatedCost: number;
    actualHours: number;
    actualCost: number;
    status: string;
    quantityGood: number;
    quantityScrap: number;
  }[];
  materials: { id: string; kind: string; description: string; quantityRequired: number; unitCost: number; estimatedCost: number; quantityIssued: number }[];
}
export interface Dashboard {
  openQuotes: number;
  quotedValue: number;
  winRate90: number | null;
  openOrders: number;
  backlog: number;
  openJobs: number;
  lateJobs: number;
}

// ── Quality ─────────────────────────────────────────────────────────────────

export interface Characteristic {
  id?: string;
  number: number;
  kind: string;
  attachmentId: string | null;
  page: number;
  x: number | null;
  y: number | null;
  nominal: number | null;
  tolPlus: number | null;
  tolMinus: number | null;
  unit: string;
  datums: string | null;
  requirement: string | null;
  operationSeq: number | null;
  sampling: "first" | "every_n" | "all";
  everyN: number | null;
  gauge: string | null;
  critical: boolean;
}

export interface JobCharacteristic extends Characteristic {
  id: string;
  lower: number | null;
  upper: number | null;
  operation: { sequence: number; workCenter: string | null; description: string | null } | null;
  due: number[];
  count: number;
  mean: number | null;
  stdDev: number | null;
  cpk: number | null;
  failures: number;
  done: number;
}

export interface InspectionResult {
  id: string;
  characteristicId: string;
  piece: number;
  value: number | null;
  passed: boolean | null;
  gauge: string | null;
  recordedAt: string;
  userName: string | null;
}

export interface JobInspection {
  job: { id: string; number: string; quantity: number; description: string };
  part: { partNumber: string; revision: string; description: string } | null;
  partPlanCount: number;
  characteristics: JobCharacteristic[];
  results: InspectionResult[];
  operations: { id: string; sequence: number; description: string | null; workCenter: string | null; status: string }[];
}

// ── Inventory ───────────────────────────────────────────────────────────────

export interface StockRow {
  id: string;
  partNumber: string;
  revision: string;
  description: string;
  type: string;
  uom: string;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  onHand: number;
  value: number;
  lots: number;
  remnants: number;
  needed: number;
  available: number;
  onOrder: number;
  lastMove: string | null;
}

export interface StockLocation {
  id: string;
  code: string;
  name: string | null;
  active: boolean;
  lots: number;
  value: number;
}

export interface StockLot {
  id: string;
  lotNumber: string;
  locationId: string;
  location: string;
  dimensions: string | null;
  heatNumber: string | null;
  supplier: string | null;
  quantity: number;
  unitCost: number;
  remnant: boolean;
  parentLotId: string | null;
  receivedAt: string;
  certs: { id: string; fileName: string; inherited: boolean }[];
  usedOn: { jobId: string; jobNumber: string; quantity: number }[];
}

export interface ItemStock {
  item: { id: string; partNumber: string; revision: string; description: string; uom: string; type: string; unitCost: number; reorderPoint: number | null; reorderQuantity: number | null };
  onHand: number;
  value: number;
  needed: number;
  available: number;
  lots: StockLot[];
  ledger: {
    id: string;
    kind: string;
    quantity: number;
    unitCost: number;
    value: number;
    note: string | null;
    createdAt: string;
    userName: string | null;
    lotId: string | null;
    lotNumber: string | null;
    dimensions: string | null;
    location: string | null;
    jobId: string | null;
    jobNumber: string | null;
    sourceType: string | null;
  }[];
  demand: { jobId: string; jobNumber: string; status: string; dueDate: string | null; required: number; issued: number; remaining: number }[];
}
