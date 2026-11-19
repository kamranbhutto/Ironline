# Ironline ERP — Modules

Each module lists its main records, the workflow it supports, and what it depends on.
Statuses are written `draft → sent → won`. Phases refer to `ROADMAP.md`.

## 1. Platform (phase 1)
- **Records:** organizations, users, memberships with roles, sessions, number sequences,
  events (audit), settings, custom fields (phase 3), attachments.
- **Workflow:** sign up a shop → invite users → set roles → configure units, currency,
  tax rates, document prefixes, branding.

## 2. CRM (phase 1)
- **Records:** customers (also used for prospects), contacts, addresses (bill/ship),
  activities (call, email, note, task), opportunities (phase 2), price lists (phase 2).
- **Workflow:** prospect → opportunity → quote → customer. Customer page shows open quotes,
  orders, jobs, shipments, invoices, quality issues, on-time delivery %, and margin.
- **Depends on:** platform.

## 3. Items, BOM and routing (phase 1)
- **Records:** items (types: manufactured part, purchased part, raw material, consumable,
  outside service, assembly), units of measure, item revisions, BOM lines
  (component item, quantity per, scrap %), routing templates (operations on work centers
  with setup time, run time per piece, outside-service vendor and cost).
- **Workflow:** create part → attach drawing → define BOM and routing → reuse when quoting.
- **Phase 3:** revision control with approval, AI routing builder from a drawing/PDF.

## 4. Work centers and resources (phase 1)
- **Records:** work centers (machine or cell) with hourly burden rate, labor rate,
  capacity hours per day, calendars, shifts; employees with skills and labor rates.
- **Used by:** quoting (cost), scheduling (capacity), shop floor (labor cost).

## 5. Quoting (phase 1)
- **Records:** quotes, quote lines (item or one-off part description, quantity breaks),
  line operations (work center, setup h, run h/piece, rate), line materials (item, qty per,
  unit cost), outside services, markup %, discounts, lead time, terms, validity date.
- **Pricing formula (shared code):** for each quantity break
  `cost = Σ material × (1+scrap) + Σ (setup + run × qty) × rate + Σ outside services`,
  `price = cost × (1 + markup)`; shows unit price, margin %, and cost breakdown.
- **Workflow:** `draft → sent → won | lost | expired`; revise creates a new revision;
  "won" converts selected lines/quantities to a sales order.
- **Phase 2:** PDF and email to customer, capable-to-promise date (checks schedule load),
  quote templates, customer portal acceptance.

## 6. Sales orders (phase 1)
- **Records:** sales orders, lines (item, qty, unit price, due date), customer PO number,
  ship-to, terms.
- **Workflow:** `draft → confirmed → in production → partially shipped → shipped → closed`.
  Each line can be fulfilled from stock or by creating a job.

## 7. Jobs / work orders and costing (phase 1 core, phase 2 costing)
- **Records:** jobs (item, qty, due date, priority, link to SO line), job operations
  (copied from the routing or quote, status per operation), job materials (planned vs issued),
  job notes/instructions, travelers (printable).
- **Workflow:** `planned → released → in progress → complete → closed`; operation status
  `pending → ready → running → done`.
- **Costing:** estimated (from the quote) vs actual (labor + material + outside) per job and
  per operation, with live margin.

## 8. Production planning and scheduling (phase 2)
- **Planning:** demand from sales orders and forecasts → net requirements against on-hand
  and on-order → suggested jobs and purchase orders (MRP-style), grouping by due date.
- **Scheduling:** finite-capacity forward scheduling of job operations onto work centers
  (respecting calendars, sequence, setup groups), drag-and-drop board, late-job warnings,
  "what if" re-runs. Grouped work: combine operations from several jobs into one run
  (e.g. one laser nest) and split the cost back to each job.

## 9. Shop floor (phase 2)
- **Records:** labor entries (employee, job operation, start/stop, setup vs run, good qty,
  scrap qty with reason), downtime entries.
- **Workflow:** tablet kiosk → pick operation from the work-center queue → start → stop with
  quantities → next operation becomes ready. Digital instructions and drawings per step.

## 10. Inventory (phase 1 ledger, phase 2 full)
- **Records:** locations (warehouse/bin), lots and serial numbers, inventory transactions
  (receipt, issue to job, return, finished goods from job, shipment, adjustment, transfer),
  cycle counts.
- **Rules:** on-hand, allocated and available are computed from the ledger; full lot
  genealogy (which raw-material lot went into which job and shipment).

## 11. Purchasing and receiving (phase 2)
- **Records:** vendors, vendor items and prices, purchase orders and lines (material or
  outside service linked to a job operation), receipts, vendor bills (phase 3).
- **Workflow:** suggestion → PO `draft → sent → partially received → received → closed`;
  receiving creates lots and inventory transactions, triggers incoming inspection.

## 12. Quality (phase 2)
- **Records:** inspection plans per item/operation (characteristics, tolerances),
  inspection results, non-conformance reports (NCR) with disposition (use as is, rework,
  scrap, return to vendor), corrective actions (CAPA), certificates of conformance,
  calibrated gauges.
- **Workflow:** failed inspection → NCR → disposition → CAPA → closed; supports
  ISO 9001 / AS9100-style records and traceability.

## 13. Shipping (phase 2)
- **Records:** shipments, shipment lines (SO line, lot, qty), packages, carrier and
  tracking number; packing slips and certificates.
- **Workflow:** pick → pack → ship; posts inventory transactions and updates the SO.

## 14. Invoicing and finance (phase 2)
- **Records:** invoices and lines (from shipments or manual), payments, credit notes,
  tax rates; accounting export/sync (QuickBooks, Xero) in phase 4.
- **Reports:** AR aging, revenue by customer, job profitability, WIP value.

## 15. Reports and dashboards (phase 2)
- Live dashboard: quotes out and win rate, bookings, backlog, late jobs, work-center load,
  on-time delivery, scrap rate, inventory value, cash expected.
- Report builder: choose a dataset, columns, filters, grouping; save and share; CSV export.

## 16. AI assistant (phase 3)
- Chat panel available on every screen. Read-only tools over the org's data (search jobs,
  explain a job's cost variance, list late orders, summarise a customer).
- Later: drafting actions that a user confirms (create a quote from an RFQ email or PDF,
  build a routing from a drawing, suggest a schedule change). Every action runs through the
  normal service layer and permission checks and is logged.

## 17. Integrations and API (phase 4)
- Public REST API with API keys, webhooks, accounting sync, CSV import/export for every
  master list, e-mail in (RFQs), CAD/nesting file import.
