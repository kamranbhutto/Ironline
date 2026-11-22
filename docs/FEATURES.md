# Ironline ERP — Feature checklist

Every capability a competitive job-shop ERP needs (from `research/competitor-capabilities.md`
plus our own additions), with status. ✅ built · 🔨 in progress · P2/P3/P4 = roadmap phase.
★ = something we plan to do better than the market.

## Files, drawings and 3D
| Feature | Status |
|---|---|
| Attach files to parts, quotes, quote lines, jobs (drawings, CAD, photos, certs) | ✅ |
| Built-in **3D viewer** for STEP/STP, IGES, STL, OBJ, 3MF/GLB models (rotate, zoom, section, measure size) | ✅ |
| CAD uploads (STEP/IGES/BREP) prepared once in the background into a light GLB, so large models open in about 2 s; "Preparing the 3D view…" while it runs; existing uploads prepared on server start | ✅ |
| 2D **DXF viewer** with flat-pattern size and cut length | ✅ |
| PDF and image drawing viewer | ✅ |
| Files carry forward quote → order → job, shown on the operator screen | ✅ |
| Part bounding box, volume and surface area from the 3D model → material estimate on the quote ★ | P2 |
| Quote-time nesting from DXF: sheet usage, cut time, yield | P2 |
| Drawing markup and customer approval ★ | P3 |
| SolidWorks / Fusion 360 / Onshape connectors | P4 |
| AI: read a drawing/PDF/spreadsheet → BOM and routing draft | P3 |
| AI: auto-bubble dimensions and tolerances on drawings → inspection plan | P3 |

## Quoting and sales
| Feature | Status |
|---|---|
| Quotes with operations, materials, outside services, markup, price override | ✅ |
| Live cost, margin, shop hours; price at other quantities | ✅ |
| Quote from a catalogue part (routing + BOM filled in) | ✅ |
| Send / lost / reopen / convert to sales order (partial lines) | ✅ |
| Quote revisions (r1, r2…) with history | P2 |
| Win/loss reasons and win-rate analytics ★ | P2 |
| PDF quote with company branding; e-mail from the app | P2 |
| Capable-to-promise ship date from the schedule | P3 |
| Vendor RFQs for outside services and material from the quote | P2 |
| Internal notes and chat on quotes | P2 |
| Auto-price from historical actual cost; similar-part search ★ | P3 |
| Customer portal: accept quotes, upload POs, see status and documents ★ | P4 |
| Sales order tracking: production, shipping, invoicing, on-time status | P2 |
| Customer tiers / price levels, tax rates | P2 |

## CRM
| Feature | Status |
|---|---|
| Customers, contacts, primary contact, payment terms | ✅ |
| Activities (calls, e-mails, tasks) and RFQ inbox ★ | P2 |
| Native pipeline (opportunities) ★ | P3 |
| HubSpot / Salesforce / Pipedrive sync | P4 |

## Parts, BOM and routing
| Feature | Status |
|---|---|
| Parts and materials, types, units, cost and price | ✅ |
| Routing with work centers, setup and run time, instructions | ✅ |
| Single-level BOM with scrap % | ✅ |
| Multi-level BOM (sub-assemblies) with cost roll-up | P2 |
| Copy a part with its BOM and routing | P2 |
| Revisions, change orders (ECO) with approval and effectivity ★ | P3 |
| Categories, tags, custom fields | P3 |
| Dimensional materials: shape, grade, gauge, size | P2 |

## Jobs and costing
| Feature | Status |
|---|---|
| Jobs from sales-order lines with copied operations/materials | ✅ |
| Status flow and release; first operation becomes ready | ✅ |
| Estimate vs revenue on the job | ✅ |
| Make-to-stock jobs; batch release | P2 |
| Live actual cost per operation (labor, machine, material, scrap) | ✅ |
| Overrun alerts; quoted vs actual report per part | P2 |
| Edit a job while in progress; split a job | P2 |
| Job routing is the order's own copy: edit it on the job, and push changes back to the part | P2 |
| Printable traveler with barcode | P2 |
| Job cost strip: labor, material, total cost, margin, revenue — estimate vs actual with difference | ✅ |
| Job stage track (approved → scheduled → in process → complete) | ✅ |
| Job tabs: files & 3D, cost by operation, log ✅ · scrap, certificates, quality P2 | partly ✅ |

## Shop floor
| Feature | Status |
|---|---|
| Operator screen per work center with queue (✅); badge/PIN kiosk login (P2) | partly ✅ |
| Start / pause / stop timers for setup, run, labor; time clock | ✅ |
| Good and scrap quantities with reasons; hand-off alerts next station | ✅ |
| Drawings and **3D model** on each operation | ✅ |
| Barcode scanning of jobs and material; label printing | P2 |
| Pick material and return remnants with size | P2 |
| Raise an NCR from the operation | P2 |
| Live status board: who is on what | P2 |
| Operator chat on each job/operation, with photos | P2 |
| Alerts from the floor (maintenance, material missing, quality hold) with a banner until cleared | P2 |
| Timer modes: setup, labor, machine; actual vs estimate bars for setup, run and quantity | ✅ |
| Material pick and return from the operator screen | ✅ |
| 3D model view with rotate, pan, section and measure tools | ✅ |
| Crew timers and multi-machine tending ★ | P3 |
| Offline-tolerant floor app ★ | P3 |
| Machine monitoring (part counts, downtime) integrations | P4 |

## Scheduling and planning
| Feature | Status |
|---|---|
| Finite-capacity auto-schedule with shifts, calendars, equipment | P2 |
| Board by machine: backlog hours and finish date per column; cards with status (running, paused, ready, setup pending), time left, priority, due, customer, part | ✅ |
| "Material missing" flag on cards; late-work percentage at the top | P2 |
| Drag-and-drop board; automatic reschedule on changes | P2 |
| Backlog/load view by work center | P2 |
| Batch similar work to cut changeovers | P3 |
| What-if scenarios | P3 |
| Labor skills, tooling and alternate work centers as constraints ★ | P3 |
| Demand planning: projected inventory timeline, min stock, forecasts | P2 |

## Grouped work and nesting
| Feature | Status |
|---|---|
| Group operations from several jobs into one run | P2 |
| Suggest nest candidates by material and due date | P3 |
| Import nests from nesting software (yield, time, image) | P3 |
| Split machine time and sheet cost back to each job; remnants | P2 |
| One-step nest completion | P2 |

## Inventory
| Feature | Status |
|---|---|
| Append-only stock ledger; locations and sites | P2 |
| Lots with certificates; lot genealogy | P2 |
| Serial numbers and as-built records ★ | P3 |
| Remnant and dimensional stock | P2 |
| Cycle counts; customer-supplied material | P2 |
| Inventory valuation per location | P2 |

## Purchasing and receiving
| Feature | Status |
|---|---|
| Vendors with prices, price breaks, lead times | P2 |
| Purchase orders for materials and outside processing ★ | P2 |
| Buy recommendations grouped by material; combined POs | P2 |
| Receiving with lots, certs, photos; route to the job | P2 |
| Receiving inspection, supplier NCR, return to vendor ★ | P2 |
| Supplier catalogue integration (metals distributors): daily price/lead-time sync, "live / syncing" badge, order sent electronically, confirmation number on the PO | P4 |
| Item pictures/thumbnails in material and part lists | P2 |
| PO page shows the jobs it buys for | P2 |

## Quality
| Feature | Status |
|---|---|
| Inspection plans tied to operations; live pass/fail | P2 |
| NCR and CAPA linked to job, operation, operator | P2 |
| First article (AS9102 style), certificate of conformance, PPAP-style packets | P3 |
| Customer-specific document templates ★ | P3 |
| CMM CSV import | P3 |
| Gauge calibration with alerts and e-signature | P2 |
| SPC charts; quarantine and recall | P3 |
| "Needs a quality plan" queue with drawing thumbnails | P2 |
| Balloon dimensions on the drawing (manual first, AI later): nominal, tolerance, GD&T, operation, FAI flag, sampling, critical | P2 |
| Inspection entry per part with live green/red on the drawing; measuring tool recorded | P2 |
| Certificates tab on the job (CoC, FAIR) generated from inspection data | P3 |

## Shipping and finance
| Feature | Status |
|---|---|
| Shipping queue; packing slips; partial shipments and backorders ★ | P2 |
| Carrier labels and tracking (ShipStation/Shippo) | P4 |
| Invoices from shipments; AR and collections | P2 |
| WIP, COGS, inventory valuation, month-end exports | P2 |
| Accounting sync (QuickBooks, Xero, NetSuite, Sage…) | P4 |
| Light built-in accounting for small shops ★ | P4 |
| Tax engines (Avalara, TaxJar) | P4 |

## Reports and AI
| Feature | Status |
|---|---|
| Dashboard: quotes, win rate, backlog, open and late jobs | ✅ |
| Prebuilt KPIs: throughput, utilization, on-time, scrap heat map | P2 |
| Report builder; CSV export everywhere; BI export | P2 |
| AI assistant over live data (read-only) | P3 |
| AI actions with approval inbox and audit ★ | P3 |
| Plain-language page/report builder | P3 |
| Scheduled and event-driven AI agents (follow-ups, margin watch) ★ | P3 |
| Public REST API, webhooks, MCP server | P4 |

## Platform
| Feature | Status |
|---|---|
| Multi-tenant shops, roles, audit events, numbering | ✅ |
| Light/dark, responsive, phone and tablet | ✅ |
| Invitations, password reset, SSO | P2 / P4 |
| Multi-site, multi-currency ★ | P4 |
| Preventive maintenance and OEE ★ | P3 |
| Tool crib and fixtures ★ | P3 |
| Data migration from legacy job-shop ERPs (CSV import) | P4 |
| ITAR / government-cloud hosting option | P4 |


## Added from the Platform pages review
From `research/platform-pages.md` (73 product screenshots, paraphrased). (inferred) items need confirming.

### Files, drawings and 3D
| Feature | Status |
|---|---|
| Assembly structure tree and exploded view in the 3D viewer (inferred) | P3 |

### Quoting and sales
| Feature | Status |
|---|---|
| Quote approval workflow ("needs approval" before sending) | P2 |
| Quote expiration date and closed date | P2 |
| Customer part number and description cross-reference on quote, order and shipping lines | P2 |
| Customer PO number and priority on quotes and sales orders | P2 |
| Line discounts and an order-level discount line | P2 |
| Time & materials pricing mode on quote lines | P3 |
| Item stock position (on hand, demand, available) on the quote line | P2 |
| Shipping tab on the quote (ship-to, method, freight) | P2 |
| Bulk-apply customer-requested date changes from a file (preview, accept, reschedule) | P3 |

### CRM
| Feature | Status |
|---|---|
| Push status updates to team-chat tools (Teams/Slack) | P4 |
| Inbound quotes from external quoting tools | P4 |
| E-commerce channel integration | P4 |

### Parts, BOM and routing
| Feature | Status |
|---|---|
| Component linked to the parent operation that consumes it | P2 |
| Make/buy flag per BOM line | P2 |
| Separate labor-per-unit and machine-per-unit run times, plus fixed setup, per operation | P2 |
| Operation overlap ("continuous flow") setting on the routing (inferred) | P3 |
| BOM import from CSV/XLSX (non-AI) | P2 |
| Raw-material estimate as blank size and yield per BOM line | P2 |
| Item lifecycle status: draft, active, archived | P2 |

### Jobs and costing
| Feature | Status |
|---|---|
| Rework action, with rework time and cost tracked separately | P2 |
| Over- and under-pick variance per material line | P2 |
| Work order that bundles several jobs from one sales order | P3 |

### Shop floor
| Feature | Status |
|---|---|
| Configurable traveler template (sections, sign-offs, QC/pallet checklist) | P3 |

### Scheduling and planning
| Feature | Status |
|---|---|
| Draft vs published schedule, with an explicit publish step and the shop time zone shown | P2 |
| Freeze window (frozen horizon) protected from auto-reschedule | P3 |
| Material availability as a scheduling constraint | P3 |

### Inventory
| Feature | Status |
|---|---|
| Inventory age per item and lot, with an aging view | P3 |
| Unit conversion between the item unit and the vendor purchase unit | P2 |

### Purchasing and receiving
| Feature | Status |
|---|---|
| Primary and secondary vendors per item, with a vendor swap during the buy | P2 |
| Minimum order quantity per vendor and item | P2 |
| PO approval states (draft, needs approval, approved, ordered) | P2 |
| Issue flag on a receipt or shipment, visible to purchasing and sales | P2 |
| Vendor scorecard: on-time delivery and quality per supplier | P3 |

### Quality
| Feature | Status |
|---|---|
| Final quality review gate before shipping | P2 |
| NCR cause category with a Pareto chart by cause | P2 |
| FAIR export to customer and third-party quality portals; EDI document sharing | P4 |
| Compliance matrix mapping AS9100/ISO clauses to features (documentation) | P4 |

### Shipping and finance
| Feature | Status |
|---|---|
| Shipment record: photos, shipped-by, freight cost, carrier account, tracking, notes (manual) | P2 |
| Customer-specific shipping label templates | P3 |

### Reports and AI
| Feature | Status |
|---|---|
| Makespan and dwell-time metrics with trend | P2 |
| Backlog waterfall (starting, added, completed, ending $) | P2 |
| Operator efficiency (earned vs actual hours) by operator, machine and job | P3 |
| Scrap-rate incentive report per operator, with export to payroll | P4 |

### Platform
| Feature | Status |
|---|---|
| User-facing searchable change log on each record (field, old→new, user, time) | P2 |

### Extra detail for rows above
These add acceptance detail to rows that already exist. Add them to the row's notes, not as new rows.

- **Attach files.** Accept the wide native-CAD format list, with a thumbnail when a file can't be
  rendered.
- **PDF quote.** A "show pricing on PDF" toggle.
- **Capable to promise.** Dates per priority level, with a last-calculated time.
- **Vendor RFQs.** Send through the user's mailbox, and apply the chosen vendor's price to the quote.
- **Customer portal.** Order chat with @mentions, a rush flag, new-order submission and invoices.
- **Multi-site.** A selling entity on each quote or order.
- **Job cost strip.** The difference in $ and %; cost rows show hours × rate.
- **Job stage track.** A date per stage, with "scheduled end" next to "due".
- **PO page shows its jobs.** The reverse too: a POs tab on the job.
- **NCR from operation.** Pre-fill operation, work center, department, equipment, job, SO, customer
  and quantity.
- **Tablet kiosk.** A routing trail on each queue card.
- **Schedule board.** Days of slack, an "over estimate" status, cards grouped by day and item role
  tags.
- **Backlog/load view.** Daily utilization % per department, with drill-in.
- **Demand planning and make-to-stock.**
  - A minimum batch size.
  - A timing-issue KPI for late sub-assemblies.
  - An "always make to stock" setting.
  - A create-jobs panel with approve & schedule.
- **Suggest nest candidates and import nests.**
  - Nest KPIs.
  - Grouping by material, thickness and machine.
  - A nest work-order record, with sheets, repeats, editable runtimes and remnant %.
  - The full nest report kept.
- **Parts and materials.** Capability flags (stock, buy, make, sell, taxable, lot-tracked) and type
  KPIs with $.
- **Stock ledger.** The value change per transaction, its dimension and the source document.
- **Remnant/dimensional stock.** A family view with the parent material, its sizes and its remnants.
- **Cycle counts.** A spreadsheet round-trip with a preview of differences.
- **Customer-supplied material.** A receipt that references the sales order (inferred).
- **Buy recommendations.**
  - KPI tiles with a horizon.
  - A lead-time warning.
  - A last-updated time and Recalculate.
- **Receiving and shipping queues.**
  - KPI tiles (ready, late, on-time %, open $, late $).
  - Several shipments per SO.
  - Bulk packing-list print.
- **Label printing.** A choice of label size and number of copies.
- **Quality plan queue.** In-execution and complete views.
- **NCR and CAPA.** Review stages: new, quality review, engineering review.
- **FAI/CoC packets.** Combine the generated documents with certs pulled from POs, then send.
- **FAIR.** A result column per serial, the tool's asset ID, resolution and calibration due date,
  and an e-signature.
- **Balloon fields.** The drawing grid zone.
- **Serial numbers.** Range allocation per job, with the next serial and a usage timeline.
- **Gauge calibration.** KPI tiles for overdue, due in 7 days and due in 30 days.
- **AR and collections.** Aging buckets per customer, invoice KPI tiles and a follow-up action.
- **Month-end exports.** An uninvoiced-shipments report.
- **Prebuilt KPIs.** Throughput $ per month and per job, against last month.
- **Live status board.** An idle-equipment count, and idle and clocked-out people.
- **Report builder.** Several views per report, aggregation, group by, breakdown, column visibility
  and favourites.
- **AI actions and agents.** Per-task auto-send for low-risk actions, a margin-below-target trigger
  and weekly overdue-invoice drafts.
- **Plain-language page builder.** Write-back with preview and accept, version history and restore,
  and publishing to roles.

### Operator screen and job page redesign (2026-11-19)

| Feature | Status |
|---|---|
| Operator screen: part fills the screen; setup, run and part-count meters along the top (green within plan, orange past it) | ✅ |
| Setup / Labor / Machine timers with one big start-pause button | ✅ |
| Count parts while the timer runs (step size + add button); scrap and rework with reasons | ✅ |
| Right panels: Details (part, customer, SO/PO, instructions, notes, routing steps), Pick, Complete (totals, times, close operation, next step), Chat | ✅ |
| Job chat with @mentions, photos from the tablet camera, and alerts with a reason (alerts also go to the job log); unread badge | ✅ |
| Job page: milestone timeline with dates, cost cards with variance badges, boxed job card with status dropdown and label printing, pill tabs, part card for BOM & routing | ✅ |
| Non-conformance reports from the operator screen | P2 (Quality module) |
| Stock locations in the pick panel | P2 (Inventory module) |
| Alert notifications to people (email/push) | P2 |

## Record pages, dashboard and BOM builder redesign (2026-11-19)

The job page layout now runs through the app:
- **Shared pieces** (`ui.tsx`): `DetailTitle` (big breadcrumb title), `MetricCard` (headline number with coloured edge), `Badge`, `TabPanel` ("Details" panel with pill tabs), `recordCard`. `PartThumb` (`components/PartThumb.tsx`) shows a part's saved 3D snapshot.
- **Quote:** stages Draft → Sent → Won with dates (lost/cancelled shows a banner); cards for total, cost, profit, margin (flag under 15%), shop hours and expiry; left card with customer, contact, validity, lead time, notes, terms; tabs Lines / Attachments / Orders. Each line is a part card with thumbnail, Custom or Catalogue tag, quantity / unit price / total tiles and a margin badge.
- **Sales order:** stages Confirmed → In production → Shipped → Closed; cards for value, jobs complete, made, shipped, days to due; tabs Lines / Attachments / Log. Each line shows its jobs with progress. The API now also returns part numbers, job quantities and a log of order and job events. The order due date is the earliest line due date.
- **Part:** cards for cost per piece, list price, margin, setup per job, run time; left card with the part fields; tabs Drawings & 3D / Cost (batch-size table).
- **BOM & routing builder** on the part page. The part, its operations as numbered chips, then its components. Made-in-house components expand to show their own routing and parts (read from their own records, with a guard against a part containing itself). In **Edit** mode a library on the left has Items (Buy/Make filters), Operations (work centers) and Materials. Add with "+ Add" or by dragging. Drag operation chips to reorder. Click a chip to set work center, instructions, setup hours and run minutes per piece. Sub-parts are edited on their own page.
- **Dashboard:** greeting with late-job warning; cards for open quotes (expiring badge), win rate, backlog, open jobs and late jobs; shop load bars per work center; Production (due next / late / running) and Sales (with customer / drafts / open orders) panels.
- **Files panel** (all records): large 3D/drawing view on top with previous/next and full screen, then a "File attachments" table: thumbnail, name (size, type, 3D preparing/failed), uploaded by and date, View / Download / Delete (asks first), Upload button and a drop strip. The file list API now returns `uploadedBy`.
- **Customer:** cards for open quotes, win rate, open orders, ordered to date, payment terms; left card with details and contacts (initials, primary highlighted); tabs Quotes / Orders / Attachments.
- **Work centers:** cards per work center with type, rate, capacity, queued hours, days of work, late jobs and a load bar; summary cards for count, running, queued hours and busiest.
- **Schedule board:** coloured status bars with icons (Running, Paused, Ready, Setup pending), priority word, short due date and step, red border on late cards, a Late % pill.

Not built yet: editing a sub-part's routing in place (open the sub-part instead); nesting (grouping sheet-metal jobs into one cutting work order, importing a nest from nesting software, completing a whole sheet at once).

### Operator screen polish (2026-11-19)
Sized for a tablet: larger job card and avatar, 226 px left panel with square Setup/Labor/Machine tiles, 148 px start button (green gradient) that becomes two orange pause bars, taller count/Label/Scrap/Rework buttons. Meters have a grey edge before work starts, green once started, orange past plan, with a gradient fill. The active panel tab is dark with a pointer underneath. Details: big part number with customer name, SO/PO, pieces and work center pill, "<work center> instructions", job notes, routing as a vertical step line (done ✓, current flag in a large pill, waiting hourglass), and a non-conformance section (button disabled until the Quality module). Pick: search / add / scan toolbar (add and scan wait for Inventory), "Materials list" cards with a Locations block ("Shop stock, not tracked" until Inventory), Return, a large quantity box and Pick. Complete: rows with dotted leaders, blue value boxes, over-plan badges on Setup and Labor, an uppercase CLOSE OPERATION button and the next operation chip. Chat: alert reason and Send alert on one line.

## Quality: inspection plans and readings (2026-11-19)

- **Part page → Inspection plan:** pick a PDF or image drawing attached to the part, zoom,
  click "Add balloons" and click each feature. Each balloon sets what it checks (length,
  diameter, radius, angle, position, flatness, perpendicularity, runout, surface finish,
  thread, or a pass/fail note), target, plus/minus tolerance (filled from the title-block
  tolerance by decimals typed), unit, datums, routing step, how often (first piece, first +
  every N, every piece), gauge, and a critical flag. Balloons can be moved or left off the
  drawing. Saved as one plan.
- **Jobs** get a copy of the plan when they are made (balloon steps line up with the job's
  operations by step number).
- **Operator screen → Inspect:** the bubbled drawing fills the screen; the panel lists the
  balloons due at this step for the chosen piece, with limits and gauge, one input each
  (pass/fail for notes). Out-of-tolerance values turn red as they are typed. Save moves to
  the next piece that still needs checking (it stays put when a check failed). The menu
  badge counts checks due on pieces already made. "Expand" shows every sampled piece.
- **Job page → Quality:** balloons with how often, step, Cpk (colour by 1.33 / 1.00),
  a spread chart of readings between the limits, and readings for the sampled pieces;
  "only issues" filter; CSV download of every reading.
- **Job page → Report:** printable first-article inspection report (part, job, customer,
  PO, each characteristic with limits, gauge, step, readings for the first piece and up to
  five later sampled pieces, accept/reject, sign-off lines). Print or save as PDF.
- **Quality page (sidebar):** readings this week, out-of-tolerance this week, share of
  readings in tolerance, parts with plans; list of every out-of-tolerance reading; jobs
  being inspected; parts with an inspection plan.
- **Not built yet:** automatic ballooning from the drawing, non-conformance reports (NCRs),
  gauge calibration records, emailing a document packet, Excel export, per-shop title-block
  tolerances, balloons on DXF/3D files.

## Inventory (2026-11-19)

- **Inventory page:** stock value, items short for open jobs, items at or below their reorder
  point, remnants; filter All / In stock / Short for jobs / Reorder / Remnants; search; per item
  on hand, needed by open jobs, available, reorder point, value, lots and remnant count.
- **Receive stock** into a new lot (auto number L-00001…): quantity in the item's unit, unit
  cost (blank = the part's cost), location, size, heat or mill lot, supplier, and an optional
  material certificate file.
- **Locations:** add, retire and reuse codes (MAIN is made on first receipt if none exist).
- **Item stock page:** on hand, needed, available, value, reorder point and order quantity
  (editable); tabs for Lots (move whole lot, adjust with a reason, add certificate, show used-up
  lots), Transactions (what, lot/location, size, change, value change, who, when; searchable),
  Open jobs that need it, and Certificates with the jobs each lot went into (traceability).
- **Part page → Stock** tab with a short summary and a link to the stock page.
- **Operator → Pick** shows the real lots (location, lot, size, on hand), oldest first, and
  "Save remnant" to put an off-cut back on the shelf.
- **Picking, returning and remnants** post to the stock ledger and cost the job from lot costs.
- **Stock take:** download a CSV of every lot, fill in counts, load it back, see the
  differences and value change (lots moved since download are flagged), then save them all.
- **Not built yet:** splitting a lot across locations, barcode scanning, Excel (.xlsx) files,
  serial numbers, expected supply from purchase orders, cycle-count schedules.

## Purchasing (2026-11-19)

- **Buying plan:** for every bought item and raw material: primary vendor and lead time,
  on hand with minimum, job demand with on-order quantity, an editable "to buy" quantity in
  the item's unit, unit cost and total. Cards filter To buy / Can't arrive in time / Urgent /
  Covered; search; "Jobs due up to" date. Badges show the shortage date and any draft order.
- **Order baskets:** "Add" puts a line in a basket per vendor; each basket shows items and
  total with Clear and Create order; the confirm step shows arrival dates (late ones red) and
  creates a draft purchase order.
- **Item details from the plan:** Expected supply (on hand, incoming, demand, projected; a step
  chart of projected stock with the minimum line and when an order placed today would arrive;
  every job and order behind it) and Vendors (several per item, one primary, lead days, cost,
  minimum order, their part number).
- **Purchase orders:** list with Open / Drafts / Received / All, next due date (overdue in
  red) and percent received; order page with stage track, totals, vendor, notes, lines,
  receipts; edit while draft, mark as sent, cancel (until something is received), print.
  "New order" builds one by hand, with item or free-text lines.
- **Receiving:** per line, partial or full, location and heat number; creates lots in
  Inventory; order status follows (partly received / received).
- **Vendors:** list with items supplied, open orders and value, terms; vendor page with the
  items they supply and their orders; add and edit vendors.
- **Inventory** shows "On order" per item.
- **Not built yet:** emailing orders, vendor units of measure, outside-processing (service)
  orders tied to a job operation, vendor price history, approval limits, bills from vendors.

## Reports and live dashboards (2026-11-19)

- **Reports page:** six ready-made starters (monthly sales and top customers, job cost
  estimate vs actual, labor hours by work center, quote pipeline, spend by vendor,
  inspection results); saved reports with star, "pin to dashboard", last changed by/at,
  delete with confirmation; "New report" picks a name and the data to report on.
- **Data available:** sales order lines, jobs, quotes, labor and machine time, inspection
  readings, stock movements, purchase order lines (each limited to the user's shop, first
  20,000 rows).
- **Report builder:** several views per report (add, copy, remove, rename); show as bar, line,
  area, pie, big numbers, table or scatter; values with sum / average / count / lowest /
  highest; group by any column (dates by day, week, month, quarter or year); split into
  series by a text column, stacked or side by side; filters (is, is not, contains, more or
  less than, on or after / before); order by name or value and show only the first N;
  underlying data table with column show/hide and paging; export CSV; save with unsaved-change
  marker.
- **Home dashboard:** pinned reports appear under the shop summary, drawn from live data each
  time the page opens.
- **Not built yet:** an AI report assistant, heat map and funnel charts, editing data from a
  report, scheduled e-mailed reports, per-user private reports, Excel export.

## 3D viewer upgrade (2026-11-19)

One toolbar in three groups, each tool with a tooltip; buttons with a small corner mark open a
menu above them.
- **Navigate:** Orbit, Pan and Zoom modes for the left mouse button; Fit (fits what is visible,
  also after exploding or isolating); Views menu with Home (3D), Front, Back, Top, Bottom, Left,
  Right and a perspective / orthographic switch.
- **Inspect:** Measure distance (with X/Y/Z split) or angle from three points, snapping to
  corners; Section along X, Y or Z with flip and a position slider (edge lines are cut too);
  Explode for assemblies with a spread slider; Display style: shaded, shaded with edges,
  wireframe, X-ray, and design colours from the CAD file.
- **Panels:** Model tree (every part by name, search, show/hide, isolate, zoom to part);
  Properties for the selected part or whole model (length, width, height, surface area,
  volume, triangles, weight for steel, stainless, aluminium, brass, copper, titanium or
  plastic); zoom to selected; save a PNG picture of the view; settings (mm or inches,
  perspective or orthographic, studio / white / dark background, floor shadow); full screen.
- Click a part to select and highlight it; double-click to zoom to it. Keys: F fit, H home,
  Esc clears the measurement, then the selection.

## Assemblies made from pieces (2026-11-20)

- **Piece jobs:** when a job's bill of materials contains parts made in house, each one gets
  its own linked job (J-00012-1, J-00012-2…) with that part's routing and materials, for the
  quantity the assembly needs; pieces of pieces work the same way.
- **Releasing** the assembly releases its piece jobs; cancelling or moving it back to planned
  does the same. The assembly's first step waits ("Waiting for pieces" on the board and a
  clear message on the floor) until every piece job is finished.
- **Finished piece jobs** put their good pieces into stock at what they cost to make, so the
  assembly picks them from Inventory like any other material.
- **Job page:** "Pieces for this assembly" cards (status, steps done, quantity made) and a
  "Piece of J-…" link on each piece job. Jobs list shows the assembly's order and customer on
  piece jobs.
- **Copy routing from the part:** a job made before its part had a routing (or after the part
  changed) takes the part's current routing, materials and piece jobs, while no time or
  material has been booked on it.
- **Standard cost rolls up:** a made part's cost is its routing (setup spread over 10 pieces)
  plus materials plus its made pieces, kept up to date when the part or any piece is saved,
  so quotes and jobs for assemblies include every piece. `npm run db:recost -w @ironline/api`
  recalculates all parts (run after upgrading or changing work-center rates).

## Packaging (2026-11-22)

Built from public descriptions of what industrial packing-optimisation tools do, with our own
maths (`packages/shared/src/packing.ts`) and wording. Supply → Packaging.

- **Packing study:** pick a part (or type a size), enter its length, width, height and weight,
  or **measure them from the part's 3D model**. Tick the containers, pallets and trucks to
  compare; every combination is counted and costed instantly and ranked by cost per part.
- **Three ways to pack:** flat layers (each part turned the way that fits most, with optional
  board pads between layers), one part per cell (with dividers, costed by board area), and
  nested stacks (parts that slide into each other, by their nest step). "This side up" keeps
  the part's height vertical.
- **Limits that are checked:** clearance around parts, the per-person lift limit, container
  load limit, pallet height and weight, carton stacking strength (from the board grade, with a
  safety factor), truck floor and payload.
- **Cost per part:** container (or a returnable's trip cost plus wear), pads and dividers,
  pallet and wrap, freight (per pallet, or per truck: fixed plus per km). Cost a full truck, or
  a real shipment quantity.
- **Find best carton size:** searches carton sizes built exactly around whole numbers of parts
  inside a size window, picks the cheapest board grade that survives the pallet stack, and
  adds the best five as "Made to size" options.
- **3D views** of the parts inside the container (with layers spread apart), the pallet, and
  the truck.
- **Returnable or one-way:** fleet size, fleet cost, yearly saving and payback months for the
  best returnable container against the best one-way one.
- **Use for this part** saves the packing spec on the part (Packing tab on the part page) and
  shows it on every job for that part, with how many containers the job needs.
- **Report:** a one-page printable packing report with the 3D picture, counts and costs.
- **Library:** cartons (with board grade), totes and crates (returnable or one-way), pallets
  (with height and weight limits) and trucks/containers. Each shop starts with a common set.

Not built (on purpose, for now): packing on the true 3D shape (nesting concave parts, free-angle
turning), poured bulk simulation, foam/tray design and CAD export of dunnage, mixed parts in one
container, and truck loading of mixed pallets.
