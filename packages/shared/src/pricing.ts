/**
 * Quote-line costing and pricing. Runs in the browser (live preview while estimating)
 * and on the server (the stored, authoritative numbers), so both always agree.
 *
 * Money is rounded to 4 decimals for costs and 2 decimals for prices at the end of each
 * step; inputs are numbers parsed from the database's numeric strings.
 */

export interface OperationInput {
  setupHours: number;
  runHoursPerUnit: number;
  /** Hourly rate (machine burden + labor) for this operation. */
  rate: number;
}

export interface MaterialInput {
  /** "material" scales with quantity; "service" is outside processing. */
  kind: "material" | "service";
  quantityPer: number;
  unitCost: number;
  scrapPct: number;
  /** Charged once for the whole line (e.g. a minimum lot charge from a plater). */
  perLot: boolean;
}

export interface LineInput {
  quantity: number;
  markupPct: number;
  unitPriceOverride?: number | null;
  operations: OperationInput[];
  materials: MaterialInput[];
}

export interface LineCost {
  quantity: number;
  laborCost: number;
  materialCost: number;
  serviceCost: number;
  totalCost: number;
  unitCost: number;
  unitPrice: number;
  totalPrice: number;
  /** Profit as a percentage of the selling price; 0 when the price is 0. */
  marginPct: number;
  operationCosts: number[];
  materialCosts: number[];
  totalHours: number;
}

export const round = (value: number, places: number): number => {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
};

export function operationCost(op: OperationInput, quantity: number): number {
  return round((op.setupHours + op.runHoursPerUnit * quantity) * op.rate, 4);
}

export function materialCost(m: MaterialInput, quantity: number): number {
  if (m.perLot) return round(m.unitCost * m.quantityPer, 4);
  const scrap = m.kind === "material" ? 1 + m.scrapPct / 100 : 1;
  return round(m.quantityPer * quantity * scrap * m.unitCost, 4);
}

export function priceLine(line: LineInput): LineCost {
  const q = line.quantity;
  if (!(q > 0)) throw new Error("quantity must be greater than 0");
  const operationCosts = line.operations.map((op) => operationCost(op, q));
  const materialCosts = line.materials.map((m) => materialCost(m, q));
  const laborCost = round(operationCosts.reduce((a, b) => a + b, 0), 4);
  let mat = 0;
  let svc = 0;
  line.materials.forEach((m, i) => {
    if (m.kind === "service") svc += materialCosts[i]!;
    else mat += materialCosts[i]!;
  });
  const materialTotal = round(mat, 4);
  const serviceCost = round(svc, 4);
  const totalCost = round(laborCost + materialTotal + serviceCost, 4);
  const unitCost = round(totalCost / q, 4);
  const unitPrice =
    line.unitPriceOverride != null
      ? round(line.unitPriceOverride, 2)
      : round(unitCost * (1 + line.markupPct / 100), 2);
  const totalPrice = round(unitPrice * q, 2);
  const marginPct = totalPrice > 0 ? round(((totalPrice - totalCost) / totalPrice) * 100, 2) : 0;
  const totalHours = round(
    line.operations.reduce((a, op) => a + op.setupHours + op.runHoursPerUnit * q, 0),
    4,
  );
  return {
    quantity: q,
    laborCost,
    materialCost: materialTotal,
    serviceCost,
    totalCost,
    unitCost,
    unitPrice,
    totalPrice,
    marginPct,
    operationCosts,
    materialCosts,
    totalHours,
  };
}

/** Price the same line at several quantities (quantity breaks shown to the customer). */
export function priceBreaks(line: Omit<LineInput, "quantity">, quantities: number[]): LineCost[] {
  return quantities.map((quantity) => priceLine({ ...line, quantity }));
}
