# Competitor "Platform" pages: screens, data and gaps

Research date: 2026-11-13. Source: the public marketing pages on fulcrumpro.com, read-only, with no login,
forms or demo booking. Everything below is paraphrased. It records **what information and actions** each
screen offers. It does not describe their visual design, and none of it should be copied as layout,
colours or branding. NEW means no row in `docs/FEATURES.md` covers the item yet. "Detail" means the
row exists and this adds acceptance detail to it.

## Scope

The Platform dropdown in the site's top navigation links to these product pages (confirmed from the
`<nav>` block of the home page HTML):

| Menu label (as shown on the site) | URL |
|---|---|
| Job tracking | /manufacturing-software/job-tracking |
| Shipping & receiving | /manufacturing-software/shipping-receiving |
| Purchase planning | /manufacturing-software/purchasing-planning |
| Jobs & costing | /manufacturing-software/production-tracking-and-job-costing |
| Autoschedule | /manufacturing-software/production-scheduling |
| Grouped work | /manufacturing-software/grouped-work-and-nesting |
| Quality control | /manufacturing-software/quality-control |
| Materials & inventory | /manufacturing-software/real-time-inventory |
| Finance | /manufacturing-software/finance-and-accounting-reports |
| Quoting & sales orders | /manufacturing-software/quoting-software-for-manufacturing |
| Custom reports | /manufacturing-software/manufacturing-dashboard-live-reports |
| BOM & routing | /manufacturing-software/bill-of-materials-and-routing |
| Launch & support | /erp-implementation |
| API & MCP docs | developers.fulcrumpro.com/docs/ (landing page only) |
| Integrations | /fulcrum-integrations |

The AI menu, which sits beside Platform, links to `/manufacturing-software/archie` and
`/manufacturing-software/builder`. Demand planning (`/manufacturing-software/demand-planning`) is not in
the dropdown, but the footer and page bodies link to it. All three are included here.

**Method and limits.** I read each page's HTML text and viewed 73 product screenshots, converted to PNG
in the session scratchpad. Logos, avatars, icons and testimonial images were skipped. A few downloaded
duplicates and marketing graphics were not opened: the shared fab job-tracking and reports thumbnails, a
nest-planning video poster, and the finance integrations graphic. The embedded click-through demos and
the background videos were **not** opened, so anything shown only inside them is missing from this
report. The AI page has no static screenshots, only videos, so its section is based on page text alone.

**Reading the labels.** "NEW" means no row in FEATURES.md covers the item, so it goes in the final
consolidated list. "Detail" means an existing row covers it and this adds acceptance detail; those are
listed separately at the end. "(inferred)" marks a reading taken from an unlabelled icon or a bare
label, where the site does not say what the control does.

---

## 1. Job tracking (operator tablet)
URL: https://fulcrumpro.com/manufacturing-software/job-tracking

**Screens seen**
- Operator work screen for one operation.
- Operator queue on phone or tablet.
- Material pick dialog.
- Nest run tab.
- Sales order "associated jobs" panel, showing how floor data rolls up.

**Visible data and actions**
- **Header.** Operator photo with a notification count, job number, item number and work center.
- **Timers.**
  - Two running timers, setup and run, each showing elapsed time against the estimate.
  - A quantity progress bar showing done out of required.
- **Section switcher.** Details, Pick, Run, Notes, Complete, plus a Nesting section on grouped operations.
- **Timer mode.** Setup, Labor or Machine, with one start/pause control.
- **Quantity entry.** A good-count stepper (minus, value, plus) and an add-quantity action.
- **Action buttons.** Print label, Scrap (with reason) and **Rework**.
- **3D model viewer** with a toolbar of unlabelled icons. Read from the icons (inferred): orbit, pan,
  zoom, walk, camera, measure, section, explode, an assembly structure tree, properties and full
  screen. A count of attachments is shown.
- **Pick dialog.**
  - Shows the material and the required amount in its stock unit (for example, pounds).
  - Has a scan-code button.
  - Lists stock locations, each with size, location and lot, and on-hand quantity, to choose from.
  - Takes a quantity, with Pick, Return or Cancel.
  - Captures remnants as length × width, with an add-remnant action.
- **Nest tab (grouped operation).**
  - Each sheet in the nest shows its size, the parts on it (part × count), runtime and repetitions.
  - A summary table shows ordered, scrap and completed quantities per part.
  - Predicted sheet picks and predicted remnants are listed with their sizes and quantities.
  - One "complete the grouped operation" action finishes it all.
- **Operator queue.**
  - Operator name and department, notification count, search, and a scan-code shortcut.
  - Filters by operation and by equipment, with a "Today" grouping.
  - Each card shows job, customer, part and revision, description, a short trail of the routing
    (previous step done, current step), status (ready) and estimated time.
- **Sales order roll-up.** Each linked job shows status, item, due date, ordered quantity, a produced
  progress bar and a shipped progress bar. Actions: create jobs, create work order.
- **What job tracking records (from the FAQ).** Machine, setup and labor time; scrap count and reason;
  pick adjustments; custom in-process checkpoints and fields; notes.
- **NCR from the floor.** The NCR is pre-filled with operation, work center, department, scheduled
  equipment, job, sales order, customer and quantity made.

**Workflow.** The operator scans a job or picks it from the queue. They start setup, then run. They
pick material by scanning, return remnants with their sizes, and count good and scrap. They can print
a label, and then complete or hand off to the next step, which alerts the next person. Time and
material post to the job cost live.

**New for our checklist**
- NEW: Rework action on the operator screen, which sends quantity back through a step and tracks
  rework time and cost separately (P2).
- NEW: Assembly structure tree and exploded view in the 3D viewer (P3, inferred from icons).
- NEW: A "work order" that bundles several jobs from one sales order (P3).
- Detail (tablet kiosk): a routing trail on each queue card showing the previous step done and the
  current step.
- Detail (attach files): accept the long list of native CAD formats in their FAQ, and show a
  thumbnail even where we cannot render the file.
- Detail (NCR from the operation): pre-fill NCR context from the operation.
- Detail (custom fields): custom in-process fields that are not dimensional, such as "drawing
  reviewed: yes/no".

---

## 2. Shipping & receiving
URL: https://fulcrumpro.com/manufacturing-software/shipping-receiving

**Screens seen**
- Shipping list.
- Receiving list.
- Receiving detail with a print-labels dialog.
- Previous shipments list.

**Visible data and actions**
- **Shipping list.**
  - KPI tiles: ready count, late count, on-time % (last 30 days), shipped this month.
  - Search, card or grid view, filter, a bulk packing-list print for checked rows, and a grid download.
  - Columns:
    - shipment ID (several shipments per sales order);
    - order;
    - status (open, ready, partially ready, shipped);
    - customer and ship-to address;
    - ship-by date, with days remaining or days overdue and a late flag;
    - shipped date;
    - ship method;
    - contact name, role and phone.
- **Receiving list.**
  - KPI tiles: open receipts (count and $), late (count and $), on-time %.
  - Columns: receipt ID, source order, vendor, status (open or received), expected date with days late.
  - Some receipt IDs reference sales-order numbers rather than POs. The site does not say why; it may
    be for customer-supplied material (inferred).
  - Any receipt can carry an "issue with vendor order" flag.
- **Receiving detail.**
  - Header: PO number, vendor, vendor contact and role, associated job.
  - Each line shows a photo, item and size spec, and a full or partial received status.
  - Received against ordered quantity in the purchase unit (for example, 10 ft or 0/0.3 pc).
  - Received or expected date, and price.
  - The print-labels dialog takes the number of copies and the label size.
- **Previous shipments.** Each row shows a photo of the packed goods, who shipped it, a timestamp with
  time zone, carrier service, freight cost, carrier account number, tracking number and notes.
- **Page text.**
  - Lot numbers are generated at receipt, with mill certs, photos, notes and timestamps attached to
    the lot.
  - Items show as ready to ship as soon as the floor completes them.
  - Shipping prompts accounting to invoice.
  - Problems can be flagged on any shipment.

**Workflow.** At the dock, receiving checks in each line (full or partial) and prints labels. A lot
is created, with cert and photo, and the material is routed to its job; any issue is flagged to
purchasing. On the outbound side, finished work appears as ready and is ordered by priority. The
team ships, partially if needed, and records carrier, freight and tracking, which raises an invoice
prompt.

**New for our checklist**
- NEW: Shipment record carrying photos of the packed goods, shipped-by, freight cost, carrier account,
  tracking number and notes, entered manually before any carrier integration (P2).
- NEW: An "issue" flag on any receipt or shipment, visible to purchasing and sales, with a note (P2).
- Detail (shipping queue): several shipments per sales order with their own IDs and statuses
  (open, ready, partially ready, shipped); KPI tiles for ready, late, on-time % and shipped this month;
  bulk packing-list print for selected shipments.
- Detail (receiving): KPI tiles for open $, late $ and on-time %; full or partial status per line.
- Detail (customer-supplied material): receiving it through a receipt that references the sales order
  (inferred).
- Detail (label printing): choose the label size and the number of copies.

---

## 3. Purchase planning
URL: https://fulcrumpro.com/manufacturing-software/purchasing-planning

**Screens seen**
- Purchase to-do list.
- Item side panel with an "expected supply" tab and a "vendors" tab.

**Visible data and actions**
- **To-do list header.** Last updated, with a **Recalculate** action.
- **KPI tiles**, each with a "through" horizon date and a $ value where relevant:
  - purchase recommended (count, $);
  - timing issue;
  - high priority ($);
  - no action needed.
- **Filters and toggles.** An active-filter chip, search by item, description, tag or vendor, an
  end-date horizon, and a toggle between the **item unit and the vendor unit**.
- **Rows.**
  - Item picture or drawing thumbnail, ID, description and tags (stock item, raw material, an
    "unverified item" tag whose meaning is not explained, and so on).
  - Vendor and lead time, with a **warning when the lead time is too long** for the need date.
  - On hand (shown negative when short) and minimum on hand.
  - Demand and incoming.
  - Recommended buy quantity, unit, minimum order quantity and total cost.
  - An "add to PO" action.
- **Expected supply tab.**
  - A projected on-hand graph over time, showing the minimum level and a vertical date marker. The
    marker is probably the lead-time horizon (inferred).
  - Tiles for on hand and available, incoming (number of POs) and demand (number of jobs).
  - A table of each source (PO, job or sales order, with its vendor or customer), quantity change,
    status, date and running expected on hand, with a low-stock flag.
  - Job lines in this table carry an edit icon.
  - PO statuses shown include needs approval, ordered, in progress and not started.
- **Vendors tab.** Each vendor shows city, status (primary or secondary), lead time in days and unit
  cost. The buyer can swap or add vendors during the buy.

**Workflow.** The planner recalculates, filters to "purchase recommended", reviews timing issues,
optionally switches vendor, and adds lines to POs; lines from several jobs are grouped by material.

**New for our checklist**
- NEW: Primary and secondary vendors per item, with lead time and unit cost, and a vendor swap during
  the buy (P2).
- NEW: Conversion between the item unit and the vendor purchase unit, with a toggle to view either (P2).
- NEW: Minimum order quantity per vendor and item (P2).
- NEW: PO approval states: draft, needs approval, approved, ordered (P2).
- Detail (buy recommendations):
  - KPI tiles for recommended, timing issue, high priority and no action needed, each with a horizon
    date.
  - A lead-time warning when the vendor's lead time runs past the need date.
  - A "last updated" time and a manual Recalculate action.

---

## 4. Jobs & costing
URL: https://fulcrumpro.com/manufacturing-software/production-tracking-and-job-costing

**Screens seen**
- Job page in two versions.
- Job detail tabs: Chat, Quality, Scrap, Cost breakdown, Certs, Attachments.

**Visible data and actions**
- **Job header.** Last updated, and a Complete action with options.
- **KPI tiles.** Labor, machine, materials, total cost, margin and revenue. Each shows the actual,
  the estimate, and the difference in both $ and %.
- **Milestone timeline with dates.** Sales order, in review, approved, scheduled, in process,
  **scheduled end**, due.
- **Job summary.** Sales order link and customer, job ID and status, priority, quantity and unit, due
  date, job notes, and print label.
- **Tabs.** Attachments, Notes, **POs**, Certs, Preview, Log, Scrap, Cost, Quality.
- **Viewers.** The PDF viewer has page navigation, zoom, download and print. An attachment strip
  shows thumbnails.
- **BOM & routing panel.** Labelled as the order's own read-only copy, with actions to push changes
  back to the part ("update parent") and to edit.
- **Per-operation detail.** Each operation in the list shows its message count. Chat per operation
  supports file attachments.
- **Quality tab.** In-operation checkpoints per operation, holding a yes/no or measured value with a
  unit, and an out-of-tolerance flag.
- **Scrap tab.** Total scrap quantity and $. Rows show operation, operator, reason, unit cost,
  quantity and total.
- **Cost breakdown tab.** Total labor hours, unit quantity, per-unit cost and total cost. Rows show
  name (with hours × rate), type (material, labor, machine or outside processing) and cost.
- **Certs tab.** Cert name (for example, a cert for lot #), created on, and view.
- **Page text.**
  - The KPI flags when cost goes over estimate, with an optional notification.
  - The planner can create POs for a job and watch the picks; over- and under-picks are visible.

**Workflow.** The planner reviews or edits the job's BOM and routing, buys material, and watches
operations and picks live. They chat with operators and review checkpoints and scrap, then complete
the job and compare estimate with actual.

**New for our checklist**
- NEW: Over- and under-pick variance per material line (required vs picked) (P2).
- Detail (PO page shows its jobs): the reverse as well, a POs tab on the job.
- Detail (job stage track): a date for every stage, with "scheduled end" shown next to "due".
- Detail (job cost strip): show the difference as both $ and % for each of labor, machine, material,
  total and margin.
- Detail (cost tab): cost rows show hours × rate so the calculation is visible.

---

## 5. Production scheduling
URL: https://fulcrumpro.com/manufacturing-software/production-scheduling

**Screens seen**
- Schedule board (all departments).
- Card anatomy diagram.
- Schedule feeding the operator job list.
- Backlog by department.

**Visible data and actions**
- **Board header.** Time zone, **Save schedule**, an alerts button, a late-% badge, search, filters,
  Reschedule and a last-updated time.
- **Machine columns.** Each column shows the backlog in hours and the projected finish date. Cards
  are grouped under collapsible day headings.
- **Card fields.**
  - job;
  - status (running, paused, ready, setup pending, setup paused, setup ready, **over estimate**);
  - time remaining;
  - **days of slack** (positive or negative);
  - priority, sales order and customer;
  - due date, operation, item and quantity;
  - a late flag;
  - item role tags (subcomponent or finished good);
  - a "material missing" chip.
- **Freeze window.** An "end of freeze window" marker inside a machine column.
- **Operator job list.** Filters by department, work center, equipment, operation, horizon date and
  status. Each row shows the part image, job and due date, sales order and customer, equipment and
  operation, operator, and an elapsed-vs-estimate bar.
- **Backlog by department.** A daily utilization % chart for each department over the next two weeks
  or so. Each day's load is split into two categories that are not labelled. Departments can be
  searched and drilled into.
- **What the scheduler uses (page text).**
  - Constraints: shifts, equipment capabilities, job equipment specifications, **material
    availability**, order of operations and time estimates.
  - It reschedules automatically when data changes, and manual drag-and-drop is allowed afterwards.
  - It supports what-if runs and rules such as batching to cut changeovers.
  - It suggests delivery dates from capacity.

**Workflow.** The scheduler runs automatically and the planner adjusts it by dragging. The planner
saves or publishes, and the operators' lists update. Backlog charts show where capacity is short.

**New for our checklist**
- NEW: A freeze window (frozen horizon) that auto-reschedule will not move (P3).
- NEW: Draft vs published schedule, with an explicit Save/Publish step and the shop time zone shown (P2).
- NEW: Material availability as a scheduling constraint, not only a flag (P3).
- Detail (board): cards grouped by day inside each machine column, with item role tags; days of slack
  (positive or negative) and an "over estimate" status on each card.
- Detail (backlog/load view): daily utilization % per department over the horizon, with drill-in.

---

## 6. Grouped work & nesting
URL: https://fulcrumpro.com/manufacturing-software/grouped-work-and-nesting

**Screens seen**
- Quote with a nest panel.
- Nest planning list.
- Nest work-order detail.
- Operator nest view.

**Visible data and actions**
- **Nest panel on a quote.** Sheet material and size, DXF name, quantity, contour, weight and cost.
  An "update nests" action recalculates material and machine-time estimates.
- **Nest planning list.**
  - KPI tiles: needs nesting, existing nests, recommended nests, due this week.
  - Candidates are grouped by material, thickness, machine and operation, with counts of nests and
    viable jobs.
- **Nest work-order detail.**
  - Header: work-order number, source nest file, sheet count, remnant %, runtime and status (draft
    and so on).
  - Tabs:
    - jobs to nest, showing job, part, quantity, customer and due date;
    - existing nests;
    - sheets, each with a thumbnail, dimensions, part count, repeat count, and a runtime that can be
      edited;
    - parts.
- **Operator nest view.** The nest report fields: machine, plate and nest dimensions, times cut,
  process, material, feed rate, kerf, production time, cut length, pierces, utilization %, plate
  weight, and the part sequence table. The operator's setup and run timers sit alongside it.
- **Page text.**
  - Any operation can be grouped (bending, powder coat and paint as well as cutting), by operation,
    sales order or due date.
  - Machine time and sheet cost are split back to each part in proportion.
  - Remnant sizes are predicted, and parts and remnants are confirmed with one click.

**Workflow.** At the quote, a DXF goes in and the nest gives the material and time. In planning, the
system recommends nests across orders by due date. The nest file is imported, which creates the nest
work order. The operator runs it and completes it in one step, and costs and remnants post.

**New for our checklist**
- No NEW rows. FEATURES.md already covers grouping, suggesting candidates, importing nests, cost
  split, remnants and one-step completion.
- Detail (suggest nest candidates): KPIs for needs nesting, existing, recommended and due this week;
  candidates grouped by material, thickness, machine and operation.
- Detail (import nests): a nest work-order record with the source file, a sheet list with repeat
  counts, editable runtimes, remnant % and a draft/released status. The full nest report (feed rate,
  kerf, cut length, pierces, utilization, plate weight) is kept for the operator to view.
- Detail (one-step completion): the operator sees the predicted picks and remnants before confirming.

---

## 7. Quality control
URL: https://fulcrumpro.com/manufacturing-software/quality-control

**Screens seen**
- Routing linked to balloons.
- Drawing ballooning tool with AI.
- Job documents tab (FAIR preview and packet).
- Serialization list.
- Tool calibration.
- NCR list.
- Audit log.
- Quality plans (three tabs).
- Final quality review.

**Visible data and actions**
- **Balloon linking.** Balloons are assigned to routing steps, so the operator knows which feature
  to measure at which operation.
- **Ballooning tool.**
  - Zoom, pan, auto-detect (AI), add balloon, delete balloon, and page navigation.
  - Each balloon stores its drawing grid zone (zone reference).
  - The AI highlights candidate dimensions and does nothing until the user confirms each one. The
    page says it learns the user's numbering sequence over time.
- **Live balloons.** Each balloon updates with every measurement and shows in or out of tolerance.
- **Job tabs.** Details, Balloons, Quality, Documents.
- **FAIR form (Form 3 style) preview.** Fields include:
  - characteristic number and reference zone;
  - requirement;
  - upper and lower tolerance;
  - results **in one column per serial number**;
  - measuring tool description and asset ID, resolution, and calibration date and due date;
  - sampling plan, quantity accepted and rejected, pass/fail;
  - **digital signature** and date.

  Actions: download, print, email.
- **Documents checklist.**
  - Generated documents: inspection report, CoC, AS9102 FAIR and the ballooned drawing, each with
    a generate action or a generated date.
  - Certs collected from purchasing: material cert (vendor), plating cert (PO number) and
    outside-process cert, each with a ready status.
  - Documents are selected with checkboxes and sent with **Send packet**.
- **Serialization.** Each item has a timeline of serial ranges used per job (job → serial range) and
  its next serial. The list can be searched.
- **Tool calibration.** KPI tiles for overdue, due within 7 days and due within 30 days. Tool search
  and add tool. Each tool shows its due date as a countdown.
- **NCR list.**
  - KPI tiles for new, quality review and engineering review.
  - A "total by cause" chart covering vendor, equipment, human, material, fixturing, process and
    customer.
  - Search.
  - A table of NCR number, company, status (new, quality review, engineering review), date and cause.
- **Audit log.** A panel to search edited data, showing user and timestamp per change.
- **Quality plans.**
  - Tabs with counts: needs plan, plan execution, plan complete.
  - *Needs plan:* item, description, drawing thumbnail, revision, customer, created date, and an
    open-ballooning action.
  - *Execution:* job, due date, customer, item, revision, job progress (% and qty x/y), current
    operation, and quality status (in quality review, within tolerance, not started). Action: review
    plan.
  - *Complete:* job, due date, customer, item, revision, and the list of ready documents (FAIR,
    material certs). Action: review job.
- **Page text.**
  - CMM CSV results are mapped to balloon checkpoints, from any CMM and any program, and each result
    is traced to the tool that captured it.
  - Customer-specific templates are made from uploaded documents (announced as coming soon).
  - Documents are shared through the customer portal and EDI.
  - Parts are tracked by lot or by serial.
  - Calibrations are signed digitally.
  - NCRs and CAPAs are linked to the job and the operator.
  - The full who/what/when/where history of each part is kept.
  - Results are graphed live with alerts.
  - Packets are formatted for AS9102 and PPAP, and the product is positioned against AS9100 and
    ISO 9001.

**Workflow.** Quality sees items that need a plan, balloons the drawing (with AI help) and links
balloons to routing steps. Operators measure in process (or CMM results are imported) and the
balloons update live. Quality monitors execution, does a final review, generates the FAIR and CoC,
collects supplier certs and sends the packet.

**New for our checklist**
- NEW: A final quality review gate before shipping (P2).
- NEW: An NCR cause category, with a Pareto chart of NCRs by cause (P2).
- NEW: A user-facing, searchable change log on each record, showing who changed which field and
  when (P2). We already store audit events; this row is about showing them in the UI.
- NEW: Export FAIR data to customer and third-party quality portals, and EDI document sharing (P4).
- NEW: A compliance matrix that maps AS9100/ISO clauses to product features, as a sales and audit
  aid (P4, documentation).
- Detail ("needs a quality plan" queue): add an in-execution view (progress, current operation,
  quality status) and a complete view (documents ready).
- Detail (NCR and CAPA): review stages: new, quality review, engineering review.
- Detail (FAI/CoC packets): a packet checklist that combines generated documents with certs collected
  from POs (material, plating, outside process); select the items and send.
- Detail (serial numbers): range allocation per job, with the next serial per item and a usage
  timeline.
- Detail (balloon fields): store the drawing grid zone on each balloon.
- Detail (FAIR): a result column per serial number, the measuring tool's asset ID, resolution and
  calibration due date, and a digital signature.
- Detail (calibration): KPI tiles for overdue, due in 7 days and due in 30 days.

---

## 8. Materials & inventory
URL: https://fulcrumpro.com/manufacturing-software/real-time-inventory

**Screens seen**
- Items grid with a side panel.
- Material transaction history.
- Material family (sizes and remnants).
- Item production section.
- Item certifications grid.
- Item detail page.

**Visible data and actions**
- **Items grid.**
  - KPI tiles for Make, Buy, Sell, Draft and Archived, each with a count and a $ value.
  - Active filter, and search by ID, description, lot, location, tag or status.
  - Grid or card view, filter, refresh and new item.
  - Columns: item and description, thumbnail, revision, type chips (make, sell, buy, lot-tracked),
    inventory quantity, expected supply (+/−), and tags (finished good, subcomponent, build to stock,
    parts sales).
  - The side panel has tabs for details, inventory, and expected supply (graph and source table).
- **Transaction history.** Each row shows source (job consumption, remnant created from a work order,
  receipt from a PO), dimension, quantity change, **value change (unit and total)**, location and lot,
  user and time.
- **Material family view.** A parent material (for example, a sheet grade and gauge) with its child
  stock sizes and remnant sizes, each with pieces and expected supply.
- **Item production section.**
  - KPIs: setup, machine and labor time; material cost; outside-processing cost.
  - The BOM and routing, with a raw-material estimate given as a blank size and yield ("blank W×L
    makes N").
  - A production history table: job, work order, started, due, completed, estimated and actual
    duration, variance, and estimated and actual unit cost.
- **Certifications grid.** Source job, quantity certified, lot number, download.
- **Item detail page.**
  - Capability flags: inventory, buy, make, sell, taxable, lot-tracked, assembled.
  - Summary: description, internal notes, tags, category, accounting.
  - KPIs: on hand, available, inventory value, **age (days)**, demand, unit cost.
  - Properties: material, grade, shape, thickness, width, height, length, unit, default location.
  - Usage tab, transactions, and an inventory-by-lot-and-location table.
  - Top-level tabs: summary, purchasing, production, sales, custom.
- **Page text.** Lot numbers are generated automatically. Cycle counts are done by **downloading the
  inventory, editing the counts and values, and uploading the file**.

**Workflow.** Material is received with an automatic lot and cert. It is picked, and remnants are
created from the floor. Shipping consumes stock. The item page shows on-hand, value, age, projected
supply and the production history.

**New for our checklist**
- NEW: Item lifecycle status: draft, active, archived (P2).
- NEW: Inventory age in days per item and lot, with an aging view (P3).
- NEW: Raw-material estimate as blank size and yield per BOM line (for example, "blank 15×10 makes 1")
  (P2).
- Detail (parts and materials, types): capability flags per item (stock, buy, make, sell, taxable,
  lot-tracked, assembled), and item-list KPIs by type with $ value.
- Detail (cycle counts): round-trip a spreadsheet (export, edit counts and values, re-import with a
  preview of the differences).
- Detail (ledger): each transaction shows the value change (unit and total), the dimension, and its
  source document.
- Detail (remnant and dimensional stock): a family view of the parent material with its stock sizes
  and remnants.
- Detail (quoted vs actual per part): the item page lists every job's estimated vs actual duration
  and unit cost.

---

## 9. Finance
URL: https://fulcrumpro.com/manufacturing-software/finance-and-accounting-reports

**Screens seen**
- Invoices list with an aging pop-over.
- Invoice document.
- Purchase orders list.
- Month-end reports.
- Integrations graphic.

**Visible data and actions**
- **Invoices list.**
  - KPI tiles for unissued, needs action, issued, paid and unpaid (each $ and count) over a date range.
  - An **aging pop-over**: current, 1–30, 31–60, 61–90 and 91+ days, with amounts and a per-customer
    breakdown.
  - Customer filter.
  - Columns: invoice and created date, customer and contact, sales order and priority, days late,
    due date, amount, shipped date.
  - A **Follow-up** action per invoice, and a grid download.
- **Invoice document.** Billing and shipping address, ship method, payment terms, issued and due
  dates, created by, lines (product, price, quantity, unit, subtotal), footer message and last
  modified. Actions: download, print, email.
- **PO list.**
  - KPI tiles for draft, needs approval, approved, ordered and late, each with $.
  - Columns: PO number and type, job, vendor, status, receiving status, ordered date, expected date
    with days until due or overdue, vendor contact and phone, total, and created by.
- **Month-end reports.** Uninvoiced shipments, monthly COGS, year-to-date invoice data (pre-tax, by
  customer and date), current inventory and WIP, each downloadable.
- **Page text.**
  - Invoices auto-fill from the sales order.
  - The KPI tiles at the top of grids can be filtered.
  - Every grid can be downloaded.
  - The accounting system stays in place, connected by a sync.

**Workflow.** A shipment prompts an invoice, which is pre-filled from the sales order. The invoice
is issued and emailed, and syncs to accounting. Finance works the unpaid and aging views, sends
follow-ups, and at month end downloads the uninvoiced-shipments, COGS, invoice, inventory and WIP
reports.

**New for our checklist**
- No NEW rows. AR and collections, invoices from shipments and month-end exports are already listed;
  PO approval is listed under Purchase planning.
- Detail (AR and collections):
  - Aging buckets (current, 1–30, 31–60, 61–90, 91+) per customer.
  - Invoice KPI tiles: unissued, needs action, issued, paid, unpaid.
  - A follow-up action per invoice that logs the contact.
- Detail (month-end exports): include an "uninvoiced shipments" report.
- Detail (purchase orders): PO list KPI tiles (draft, needs approval, approved, ordered, late) and
  days to or past the expected date.
- Detail (invoices): download, print and email an invoice, with a configurable footer message.

---

## 10. Quoting & sales orders
URL: https://fulcrumpro.com/manufacturing-software/quoting-software-for-manufacturing

**Screens seen**
- Quote detail with a line panel.
- New quote form.
- Quote import.
- Capable-to-promise widget.
- Sales order (jobs, notes, files).
- Customer portal.

**Visible data and actions**
- **Quote header.** Quote number with a warning indicator, last modified by and created by, and tabs
  for Details, **Shipping** and Preview.
- **Quote details.**
  - customer, and status (draft, **needs approval** and so on);
  - currency, customer tier and **priority**;
  - salesperson and customer contact;
  - opportunity;
  - **selling company (entity)**;
  - **customer PO number**.
- **Billing.** Payment terms, billing address, and a **show pricing on PDF** toggle.
- **Deliverables timeline.** Quoted date, **expiration date** and closed date.
- **Custom fields**, including a loss reason.
- **Line panel.**
  - **Customer item toggle**, with the customer's part ID and the customer's description.
  - Item name, unit of measure and description.
  - **Pricing modes:** margin-based, discount and **T&M**.
  - Quantity, unit price, margin % and subtotal.
  - A link to the BOM and routing.
  - **Inventory on hand, demand and available** for the item.
  - Cost breakdown of material, labor, machine, total and margin, with a **per-unit / total toggle**
    and a link to the full breakdown.
  - Accounting: taxable flag, tax code, rate and **override rate**.
- **Quote summary.** List items, keeping the original price next to any override. A discount line
  and a tax line. Subtotal, discount, tax, total and margin. Actions: add item, add other.
- **Internal notes thread** with authors and timestamps.
- **Quote import.** Bring in a quote's lines from a file (shown as a full-quote import).
- **Capable to promise.** Estimated completion dates for low, moderate and high priority, the time it
  last ran, and a Calculate action.
- **Sales order.**
  - Associated jobs, each showing status, job, item, due date, ordered quantity, a produced bar and a
    shipped bar.
  - Actions: create job, create work order.
  - A notes thread with send and clear.
  - An attachments gallery with descriptions.
- **Customer portal.**
  - Branded with the shop's own identity. Navigation: orders (with a count), quotes, settings.
  - Order list: order number, total, status (review, new, in progress, shipped, complete) and
    delivery due date.
  - A **New order** action, and filters.
  - The order panel shows part images, a **rush order** tag, a two-way **chat between buyer and shop
    with @mentions**, system events (for example, a due-date change) and shared files.
  - The page text says invoices are visible too.
- **Page text.** RFQs are sent to vendors from the app through the user's email, and the selected
  vendor's cost is added to the quote automatically.

**Workflow.** A quote is built by importing or adding lines, nesting DXFs and pulling BOM costs.
Prices are set by margin or discount. The quote goes for approval if needed, then out as a PDF with
or without prices; CTP gives the lead time. The won quote becomes a sales order that creates jobs or
a work order, and the customer then follows progress, chat and files in the portal.

**New for our checklist**
- NEW: Quote approval workflow ("needs approval" before sending) (P2).
- NEW: Quote expiration date and closed date (P2).
- NEW: Customer part number and customer description on quote, sales order and shipping lines, as a
  cross-reference (P2).
- NEW: Line discounts and an order-level discount line (P2), and a time & materials pricing mode (P3).
- NEW: Item stock position (on hand, demand, available) shown on the quote line (P2).
- NEW: Customer PO number and priority on quotes and sales orders (P2).
- NEW: A shipping tab on the quote (ship-to, method, freight) (P2).
- NEW: Bulk-apply customer-requested date changes from a file: preview, accept, update job due
  dates, add job notes, reschedule (P3). This comes from the app-builder page.
- Detail (PDF quote): a "show pricing on PDF" toggle.
- Detail (multi-site): a selling entity (company) on each quote or order.
- Detail (customer portal): two-way chat per order with @mentions, a rush-order flag, new-order
  submission and visible invoices.
- Detail (capable to promise): dates per priority level, with a last-calculated time.
- Detail (vendor RFQs): send through the user's mailbox and apply the chosen vendor's price to the
  quote automatically.

---

## 11. Custom reports (live dashboards)
URL: https://fulcrumpro.com/manufacturing-software/manufacturing-dashboard-live-reports

**Screens seen**
- Real-time operations.
- Real-time personnel.
- Production reporting.
- Scrap reporting.
- Report builder in two states.

**Visible data and actions**
- **Real-time operations.**
  - Time window and last updated, search and view filter.
  - KPI tiles: over estimate (x/y, %), complete, late, **idle equipment**.
  - Rows: status, work center and operation type, part image, job, part and description, operators
    (more than one allowed), and actual vs estimated time with %.
- **Real-time personnel.**
  - KPI tiles: active, idle, on time and over estimate (x/y, %).
  - Rows: status (active, idle, clocked out), person and current work center, job and part, and time
    on shift vs shift length with %.
- **Production reporting.**
  - Shop throughput: total $, $ per job, number of jobs, and change vs last month.
  - Monthly throughput bars with %, and year-to-date or month selectors.
  - A **backlog waterfall**: starting, added, completed, ending.
  - **Median makespan** (minimum and maximum) and **average dwell time**, with trend.
  - Download.
- **Scrap reporting.** Scrap over time per equipment, filtered by department, work center and time
  range. A daily count chart and a work center × day heat map.
- **Report builder.**
  - All reports, favourite, an unsaved-changes indicator, AI assist, edit data, save and export.
  - Several views per report (table, chart, KPI).
  - Filter and sort.
  - The Data panel: values with aggregation, group by, breakdown, and column visibility. A Format
    panel and a chart-type selector.
- **Page text.** Ask a question and the AI builds the report. Every section can be exported to CSV.

**Workflow.** Managers watch the live operations and people boards to spot overruns and idle
machines. They review the monthly throughput, makespan and scrap heat maps, and build and save their
own reports, by hand or by asking the AI, then export them to CSV.

**New for our checklist**
- NEW: Makespan (order-to-complete time) and dwell time (wait between operations) metrics, with trend
  (P2).
- NEW: A backlog waterfall: starting backlog $, added, completed, ending backlog $ per period (P2).
- NEW: Operator efficiency: earned hours vs actual hours, by operator, machine and job, with a target
  line (P3). This comes from the app-builder page.
- Detail (prebuilt KPIs, throughput): throughput $ per month and per job, with change vs last month.
- Detail (live status board): an idle-equipment count, and idle and clocked-out states for people.
- Detail (report builder): several views per report, aggregation, group by, breakdown, column
  visibility and favourites.

---

## 12. BOM & routing
URL: https://fulcrumpro.com/manufacturing-software/bill-of-materials-and-routing

**Screens seen**
- Multi-level BOM and routing editor, with a routing-settings side panel.

**Visible data and actions**
- **Editor header.** Item thumbnail, quantity, unit cost and total cost. Actions: collapse all, expand
  all, update parent, done editing.
- **Routing per assembly level.** Each assembly level has its own routing, with an add-operations
  action and a settings action.
- **Child rows.**
  - A make or buy flag, thumbnail, number and name.
  - Total quantity and unit.
  - **The parent operation at which the child is consumed** (for example, "consumed at step 1,
    Welding").
  - Drag handles.
- **Raw material rows.** Weight (for example, lb), unit cost and extended cost.
- **Routing settings panel.**
  - Routing notes.
  - A **continuous flow** toggle. It is not explained; it may let operations overlap (inferred).
  - Each operation has a fixed setup time, a **labor time per unit** and a **machine time per unit**,
    with add operations.
  - Attachments (DXF flat pattern, image, PDF, native CAD) can be uploaded or deleted.
- **Page text.**
  - A BOM can be built from images, PDFs, CSV or XLSX.
  - BOM and routing can be copied from another part.
  - The editor supports drag and drop.

**Workflow.** An engineer imports a BOM from a file, or copies one from another part, and adjusts it
by dragging. They add routing operations with setup, labor and machine times for each level, attach
the drawings, and save. Costs roll up, and the routing goes to quotes, jobs and the floor.

**New for our checklist**
- NEW: Each component is linked to the parent operation that consumes it, which drives when it is
  needed on the schedule and when it is picked (P2).
- NEW: A make/buy flag on each BOM line (P2).
- NEW: Separate labor-per-unit and machine-per-unit run times on each operation, alongside the fixed
  setup time (P2).
- NEW: Operation overlap ("continuous flow"), so the next step can start before the previous step
  finishes its batch (P3, the meaning is inferred).
- NEW: BOM import from CSV/XLSX without AI (P2). AI import from PDF or image is already P3.
- Detail (multi-level BOM): collapse and expand all, a routing per sub-assembly, and drag-and-drop
  reorder.

---

## 13. Demand planning (linked from page bodies)
URL: https://fulcrumpro.com/manufacturing-software/demand-planning

**Screens seen**
- Demand planning list.
- Item projection panel.
- Create-jobs panel.

**Visible data and actions**
- **Header.** Refresh data.
- **KPI tiles.** Timing issue, below minimum, production recommended (count and $), high priority, no
  action needed.
- **Filters.** Search by item, lot or location, end date, and filter.
- **Rows.**
  - Thumbnail, number and description.
  - Tags: make-or-buy, high priority, subcomponent, finished good, and custom tags.
  - On hand and minimum on hand.
  - Demand and incoming.
  - **Recommended production quantity and production minimum (minimum batch).**
- **Projection panel.** Expected on-hand graph (can be hidden). On hand and available, incoming (jobs)
  and demand (sales orders). A source, change, status, date and expected on-hand table with a low flag.
- **Create-jobs panel.** One or more job blocks, each with quantity to make, production due date,
  optional job ID, priority and an **approve & schedule** checkbox. Actions: add another job, create N
  jobs, clear all.
- **Page text.**
  - "Always make to stock" can be set per item.
  - The timing-issue KPI catches a sub-assembly that will not be ready for its parent.
  - Releases can be made in batches.

**Workflow.** The planner refreshes the list and filters by timing issue, below minimum or high
priority. They open an item's projection, then split the recommendation into one or more jobs with
their own quantity, date and priority, and create them already approved and scheduled. Material
needs then flow on to purchase planning.

**New for our checklist**
- No NEW rows. The demand-planning and make-to-stock/batch-release rows already cover this.
- Detail (demand planning):
  - Recommended production quantity from on hand, minimum, demand and incoming, respecting a minimum
    batch size.
  - A timing-issue KPI for sub-assemblies that will be late for their parent.
  - An "always make to stock" item setting.
- Detail (make-to-stock and batch release): a create-jobs panel that splits one recommendation into
  several jobs, with "approve & schedule" in the same step.

---

## 14. AI assistant (AI menu)
URL: https://fulcrumpro.com/manufacturing-software/archie

**Screens seen.** None. The page has only background videos, which were not opened, so this section
is based on the page text.

**Capabilities described**
- **Chat.**
  - Answers questions from live data, for example: hot jobs due this week, the true cost of a job,
    which vendors are late most often, how the scheduler logic works.
  - Can **take actions**: change a due date, add a note to a job, update a record.
- **App builder.** Builds dashboards, apps and automations from a description.
- **Agents (announced, not live).**
  - A pre-configured library: quoting from a drawing, procurement, an overdue-invoice chaser
    (weekly), margin watch (triggered when a job's margin drops below target), and a vendor
    scorecard (monthly).
  - Custom agents can run on a schedule, on an event, or from third-party tools.
- **Safety.** Work is routed for approval by default, and the user chooses which low-risk tasks may
  run on their own. A segregated hosting option is offered for regulated (ITAR) customers.

**Workflow.** A user asks a question in chat and gets an answer from live data, then asks the
assistant to take the next step. The step is prepared and waits for approval. Agents run on a
schedule or on an event and put drafts in the same approval flow.

**New for our checklist**
- NEW: Vendor scorecard: on-time delivery and quality per supplier, monthly (P3, also useful without AI).
- Detail (AI actions with approval inbox): a per-task "auto-send allowed" setting for low-risk actions.
- Detail (event-driven agents): margin-below-target trigger, weekly overdue-invoice drafts.

## 15. App builder (AI menu)
URL: https://fulcrumpro.com/manufacturing-software/builder

**Screens seen.** Three published example apps (anonymized sample data) and an interactive text demo:
- a work-order traveler;
- an operator-efficiency dashboard;
- a customer-specific shipping-label generator;
- a scrap bonus tracker;
- a ship-date board;
- a customer date-change importer.

**Visible data and actions**
- **Traveler app.**
  - Work order number, customer and customer PO, due date, and a scan code.
  - Operations with work center, hours and sign-off boxes.
  - Material lines, each with its PO and arrival status (in, or expected date).
  - Linked jobs with their running or next status, and floor notes.
  - A QC and pallet checklist per part, with released, completed and date fields.
- **Operator efficiency app.**
  - Period, department and operator filters.
  - Efficiency %, parts, earned hours and actual hours.
  - A per-operator bar against a target.
  - Drill-in on one operator: trend, results by machine and results by job.
- **Shipping label app.**
  - A shipment list filtered to one customer.
  - A label showing supplier number, deliver-to (dock or line-side), customer part and revision,
    customer PO, quantity, pack x of y, heat/lot, kanban number, handling marks, a "CoC enclosed"
    mark and an inspected mark.
  - A print action.
- **Platform behaviour.**
  - Apps can write back to the system (move a job, set a due date, open an NCR) with an
    accept-before-change preview.
  - Apps are published to the team and respect existing permissions.
  - Every version is kept and can be restored.
  - Viewers are unlimited, and there is a yearly AI allowance.

**Workflow.** A manager describes the tool they want, or drops in a file. The AI builds a page on
live data, which the manager reviews and publishes to the team. Users act from the page, and any
write is previewed and accepted before it is saved. Edits create new versions that can be restored.

**New for our checklist**
- NEW: A configurable traveler template per shop: choose the sections, sign-off boxes and QC/pallet
  checklist (P3).
- NEW: Customer-specific shipping label templates: customer part, PO, revision, heat/lot, pack x of y,
  kanban, handling marks (P3).
- NEW: A scrap-based operator incentive report: scrap rate vs target per operator, with an approved
  list exported to payroll (P4).
- Detail (plain-language page builder): write-back with a preview and accept step, version history
  with restore, publish to roles.

## 16. Launch & support (Platform menu)
URL: https://fulcrumpro.com/erp-implementation

**Screens seen.** None that show the product. The page has staff photos and an interactive timeline
estimator.

**What the page shows**
- A four-phase launch: define, build, validate, launch.
- A dedicated launch manager who handles data migration and role-based training.
- A fixed one-time fee, unlimited support, an account manager after go-live, and a user community.
- An interactive "estimate your timeline" tool.

**Workflow.** Kickoff, then data migration and workflow build, then day-in-the-life testing and
connecting integrations, then training, go-live and stabilization.

**New for our checklist**
- No product rows. The data-migration row (P4) already covers the software side. The timeline
  estimator is a go-to-market idea, not a feature.

## 17. Integrations (Platform menu)
URL: https://fulcrumpro.com/fulcrum-integrations

**Screens seen.** Only an animated hero mock-up of sync events (inventory lot and location, quote
won/lost synced to CRM, a tax code, a shipment with freight and tracking, an outside-processing
invoice). No real product screens.

**What the page shows**
- **Categories.** Accounting, analysis, CAD/CAE/CAM, CRM, e-commerce, machine monitoring, shipping,
  tax, quoting, nesting and other.
- **Notable integration types.**
  - Metals-distributor pricing and PO sync.
  - Nest-report PDF import from several nesting packages.
  - Native-CAD model upload to create a BOM and routing.
  - Machine-monitoring cycle times and part counts.
  - Accounting sync (cloud and desktop).
  - Shipping-platform sync.
  - Tax-engine sync.
  - CRM sync.
  - **Status updates pushed to a team-chat tool.**
  - **Document generation through a document-automation tool.**
  - **Quotes pushed in from external quoting tools.**
  - **FAIR export to a customer quality portal.**

**Workflow.** Integrations are mapped during launch and then sync in the background.

**New for our checklist**
- NEW: Push job and order status updates to team-chat tools (Teams/Slack) (P4).
- NEW: Inbound quotes from external quoting tools, which create a quote or sales order in our system (P4).
- NEW: E-commerce channel integration (P4).
- (The FAIR export to quality portals is listed under Quality.)

## 18. API & MCP docs (Platform menu)
URL: https://developers.fulcrumpro.com/docs/. Only the landing page was opened.

**What it shows.** A developer hub introduction to a public REST API for each customer site, with
getting-started and authentication guides and an API schema reference. The menu label also mentions
MCP.

**New for our checklist.** None. The public REST API, webhooks and MCP server row (P4) already covers
this.

---

# Missing from FEATURES.md (consolidated)

These are the items that no row in FEATURES.md covers today, grouped by FEATURES.md's own module
headings. Each is one line with a suggested phase. Items marked (inferred) rest on an unlabelled
control and should be confirmed before building.

## Files, drawings and 3D
- Assembly structure tree and exploded view in the 3D viewer (inferred) — P3

## Quoting and sales
- Quote approval workflow ("needs approval" before sending) — P2
- Quote expiration date and closed date — P2
- Customer part number and description cross-reference on quote, order and shipping lines — P2
- Customer PO number and priority on quotes and sales orders — P2
- Line discounts and an order-level discount line — P2
- Time & materials pricing mode on quote lines — P3
- Item stock position (on hand, demand, available) on the quote line — P2
- Shipping tab on the quote (ship-to, method, freight) — P2
- Bulk-apply customer-requested date changes from a file (preview, accept, reschedule) — P3

## CRM
- Push status updates to team-chat tools (Teams/Slack) — P4
- Inbound quotes from external quoting tools — P4
- E-commerce channel integration — P4

## Parts, BOM and routing
- Component linked to the parent operation that consumes it — P2
- Make/buy flag per BOM line — P2
- Separate labor-per-unit and machine-per-unit run times, plus fixed setup, per operation — P2
- Operation overlap ("continuous flow") setting on the routing (inferred) — P3
- BOM import from CSV/XLSX (non-AI) — P2
- Raw-material estimate as blank size and yield per BOM line — P2
- Item lifecycle status: draft, active, archived — P2

## Jobs and costing
- Rework action, with rework time and cost tracked separately — P2
- Over- and under-pick variance per material line — P2
- Work order that bundles several jobs from one sales order — P3

## Shop floor
- Configurable traveler template (sections, sign-offs, QC/pallet checklist) — P3

## Scheduling and planning
- Draft vs published schedule, with an explicit publish step and the shop time zone shown — P2
- Freeze window (frozen horizon) protected from auto-reschedule — P3
- Material availability as a scheduling constraint — P3

## Inventory
- Inventory age per item and lot, with an aging view — P3
- Unit conversion between the item unit and the vendor purchase unit — P2

## Purchasing and receiving
- Primary and secondary vendors per item, with a vendor swap during the buy — P2
- Minimum order quantity per vendor and item — P2
- PO approval states (draft, needs approval, approved, ordered) — P2
- Issue flag on a receipt or shipment, visible to purchasing and sales — P2
- Vendor scorecard: on-time delivery and quality per supplier — P3

## Quality
- Final quality review gate before shipping — P2
- NCR cause category with a Pareto chart by cause — P2
- FAIR export to customer and third-party quality portals; EDI document sharing — P4
- Compliance matrix mapping AS9100/ISO clauses to features (documentation) — P4

## Shipping and finance
- Shipment record: photos, shipped-by, freight cost, carrier account, tracking, notes (manual) — P2
- Customer-specific shipping label templates — P3

## Reports and AI
- Makespan and dwell-time metrics with trend — P2
- Backlog waterfall (starting, added, completed, ending $) — P2
- Operator efficiency (earned vs actual hours) by operator, machine and job — P3
- Scrap-rate incentive report per operator, with export to payroll — P4

## Platform
- User-facing searchable change log on each record (field, old→new, user, time) — P2

# Details for existing FEATURES.md rows (not new rows)

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
