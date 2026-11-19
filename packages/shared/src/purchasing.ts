/**
 * Purchase planning for one item: given stock on hand, the minimum to keep, dated demand from
 * jobs and dated incoming purchase orders, work out how much to buy, when stock runs out, and
 * whether an order placed today can arrive in time.
 */

export interface PlanEvent {
  /** ISO date (yyyy-mm-dd); null means "now" (no due date set). */
  date: string | null;
  quantity: number;
  /** Job priority (90 urgent, 70 high, 50 normal, 30 low) for demand. */
  priority?: number;
  label?: string;
}

export interface PlanInput {
  today: string;
  /** Only demand and incoming due on or before this date count. */
  endDate: string;
  onHand: number;
  /** Minimum to keep on the shelf (the item's reorder point). */
  minOnHand: number | null;
  demand: PlanEvent[];
  incoming: PlanEvent[];
  leadDays: number | null;
  /** Smallest amount the vendor sells (or the item's usual reorder quantity). */
  minOrder: number | null;
}

export interface TimelinePoint {
  date: string;
  change: number;
  balance: number;
  kind: "start" | "demand" | "incoming";
  label?: string;
}

export interface PlanResult {
  demand: number;
  incoming: number;
  /** On hand + incoming − demand by the end date. */
  projected: number;
  toBuy: number;
  /** First date the projected stock goes below zero (jobs cannot be supplied). */
  shortageDate: string | null;
  /** Date an order placed today would arrive (today + lead time). */
  arrival: string | null;
  /** Stock runs out before an order placed today could arrive. */
  late: boolean;
  /** Runs out within 7 days, or an urgent job is short. */
  urgent: boolean;
  timeline: TimelinePoint[];
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
export const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function planItem(p: PlanInput): PlanResult {
  const within = (e: PlanEvent) => (e.date ?? p.today) <= p.endDate;
  const events = [
    ...p.demand.filter(within).map((e) => ({ ...e, date: e.date && e.date > p.today ? e.date : p.today, change: -e.quantity, kind: "demand" as const })),
    ...p.incoming.filter(within).map((e) => ({ ...e, date: e.date && e.date > p.today ? e.date : p.today, change: e.quantity, kind: "incoming" as const })),
  ].sort((a, b) => (a.date === b.date ? (a.kind === "incoming" ? -1 : 1) : a.date < b.date ? -1 : 1));

  let balance = p.onHand;
  let shortageDate: string | null = null;
  let urgentShort = false;
  const timeline: TimelinePoint[] = [{ date: p.today, change: 0, balance: r4(balance), kind: "start" }];
  for (const e of events) {
    balance = r4(balance + e.change);
    timeline.push({ date: e.date, change: r4(e.change), balance, kind: e.kind, label: e.label });
    if (balance < 0 && !shortageDate) shortageDate = e.date;
    if (balance < 0 && e.kind === "demand" && (e.priority ?? 50) >= 90) urgentShort = true;
  }
  const demand = r4(events.filter((e) => e.kind === "demand").reduce((a, e) => a - e.change, 0));
  const incoming = r4(events.filter((e) => e.kind === "incoming").reduce((a, e) => a + e.change, 0));
  const projected = r4(p.onHand + incoming - demand);
  let toBuy = r4(Math.max(0, (p.minOnHand ?? 0) - projected));
  if (toBuy > 0 && p.minOrder && p.minOrder > toBuy) toBuy = p.minOrder;
  const arrival = p.leadDays == null ? null : addDaysIso(p.today, p.leadDays);
  return {
    demand,
    incoming,
    projected,
    toBuy,
    shortageDate,
    arrival,
    late: !!shortageDate && !!arrival && arrival > shortageDate,
    urgent: !!shortageDate && (shortageDate <= addDaysIso(p.today, 7) || urgentShort),
    timeline,
  };
}
