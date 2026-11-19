import { useParams } from "react-router";
import { BRAND } from "@ironline/shared";
import { ButtonLink, Card, PageHeader } from "../components/ui.tsx";

const PLANNED: Record<string, { title: string; phase: string; points: string[] }> = {
  schedule: {
    title: "Schedule",
    phase: "Phase 2",
    points: ["Finite-capacity schedule of every job operation on every work center", "Drag-and-drop board with late-job warnings", "Promise dates on quotes from real shop load", "Group operations from several jobs into one run (nesting)"],
  },
  "shop-floor": {
    title: "Shop floor",
    phase: "Phase 2",
    points: ["Tablet kiosk: pick the next operation from the work-center queue", "Start and stop labor, record good and scrap quantities", "Drawings and instructions at each step", "Live actual cost on every job"],
  },
  quality: {
    title: "Quality",
    phase: "Phase 2",
    points: ["Inspection plans per part and operation", "Non-conformance reports with disposition and corrective action", "Certificates of conformance and first-article reports", "Gauge calibration records"],
  },
  inventory: {
    title: "Inventory",
    phase: "Phase 2",
    points: ["Stock by location and lot, from an append-only ledger", "Issue material to jobs; receive finished goods", "Lot traceability from raw material to shipment", "Cycle counts and remnant tracking"],
  },
  purchasing: {
    title: "Purchasing",
    phase: "Phase 2",
    points: ["Vendors and price breaks", "Purchase orders for materials and outside processing", "Buy suggestions from open demand", "Receiving with lots and certificates"],
  },
  shipping: {
    title: "Shipping",
    phase: "Phase 2",
    points: ["Pick, pack and ship against sales orders", "Partial shipments and backorders", "Packing slips and carrier tracking"],
  },
  invoicing: {
    title: "Invoicing",
    phase: "Phase 2",
    points: ["Invoices from shipments", "Payments and receivables aging", "Sync to accounting software (phase 4)"],
  },
  reports: {
    title: "Reports",
    phase: "Phase 2",
    points: ["Job profitability, on-time delivery, scrap rate", "Report builder with saved views and CSV export"],
  },
  assistant: {
    title: BRAND.assistantName,
    phase: "Phase 3",
    points: ["Ask questions about your shop in plain language", "Explain why a job is late or over cost", "Draft quotes from an RFQ e-mail or drawing for you to approve"],
  },
};

export function ComingSoonPage() {
  const { module = "" } = useParams();
  const p = PLANNED[module];
  if (!p) return <NotFoundPage />;
  return (
    <>
      <PageHeader title={p.title} sub={`Planned for ${p.phase}`} />
      <Card title="What this module will do">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {p.points.map((pt) => (
            <li key={pt}>{pt}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export function NotFoundPage() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <div className="mt-4">
        <ButtonLink to="/">Go to the dashboard</ButtonLink>
      </div>
    </div>
  );
}
