# Competitor Capability Research: Fulcrum (fulcrumpro.com)

Researched 2026-11-13 from public marketing pages, the public integrations page, the public YouTube channel listing, and the public developer docs index. Everything below is paraphrased into generic industry terms. Nothing here is copy, UI, or a field-level schema. It records what a competitive job-shop ERP needs to cover. It is not a design to replicate.

Pages read: quoting, job tracking, production tracking and job costing, scheduling, grouped work and nesting, quality, inventory, purchasing planning, shipping and receiving, finance, dashboards and reports, BOM and routing, demand planning, the AI assistant, and integrations.

Positioning notes: cloud and browser-based (desktop, tablet, phone); aimed at job shops and fabricators (sheet metal, machining, aerospace and defense); claims readiness for AS9100D, ISO 9001, ITAR, and CMMC. It markets itself as a replacement for ProShop, JobBOSS/E2, and Global Shop, and offers a data-migration tool for JobBOSS.

---

## 1. Capabilities by module

### Quoting & Sales
- Build quotes with line items backed by a BOM and routing. Labor, material, and machine-time cost roll up live as you edit.
- Import a BOM from drawings or files (PDF, image, CSV, XLSX) with AI help. Attach CAD and other files, which carry forward to the job.
- Upload a flat-pattern DXF to a quote to auto-nest it, which refreshes material use and machine-time estimates.
- **Capable-to-promise:** propose a ship date from current schedule load and capacity before committing.
- Send vendor RFQs from the quote through email sync, track replies, and pull the chosen vendor cost into the quote.
- Collaborate on quotes with internal notes, chat, and attachments.
- Convert a quote to a sales order. Expected cost and margin carry through and update live.
- Track sales order progress (production, shipping, invoicing) and flag on-time or late status for sales staff.
- Customer portal: customers log in to see order status, shipments, invoices, and quality documents.
- Workflow: RFQ received -> quote (BOM, routing, nest, vendor quotes) -> CTP date -> send quote -> follow up -> sales order -> job(s) released.

### CRM
- Native CRM is thin: customer records, customer tiers (pricing levels), payment terms, and tax rates.
- Pipeline and deals are left to external CRMs through integrations (HubSpot, Salesforce, Pipedrive, Zoho, and others).
- The AI assistant drafts follow-ups for quotes still in "sent" status.

### BOM & Routing
- Multi-level BOMs (assemblies, subassemblies, purchased and raw material) with a drag-and-drop editor.
- Copy a BOM and routing from an existing part, then modify the copy.
- Routing = ordered operations, each tied to a work center or equipment, with estimated setup and run times, notes, attachments, and production settings.
- Changes to notes and instructions reach shop-floor screens immediately.
- The AI uploader builds a BOM from drawings and spreadsheets. SolidWorks and Fusion 360 models can be uploaded.
- One BOM and routing record serves quote, sales order, job, purchasing, and scheduling, so nothing is re-entered.
- The API exposes change orders, which suggests revision and change-control handling. The marketing pages say little about revisions.

### Jobs & Costing
- A job (work order) is created from a sales order line, for stock (make-to-stock), or from demand-planning recommendations.
- Review the BOM, routing, and estimated cost before release. Release jobs one at a time or in batches.
- **Live costing:** estimate vs. actual per operation for labor, machine, and material. Overruns are flagged and can notify people.
- Material actuals come from operator picks, including over-picks and under-picks. Scrap is costed with who, why, and how much.
- Edit a job while it is in progress (also covered in a release video).
- Compare quoted and actual cost to find unprofitable parts and feed repricing on the next quote.
- Job record holds messages to operators, file attachments, certifications, and quality checkpoints.

### Shop-floor tracking
- Digital traveler: each operation shows instructions, drawings (interactive), and the next routing step.
- Start, pause, and stop timers per operation for labor, setup, and machine time. A time clock is kept separate from job timers.
- Barcode scanning opens an operation and picks material. Print labels on the floor.
- Pick material against a job and return remnants to stock (with dimensions). Inventory adjusts automatically.
- Record scrap quantity and reason, inventory adjustments, in-process checkpoint data, and notes.
- Complete or hand off an operation, which alerts the next operator or station.
- Raise an NCR from the operation, with job, operation, customer, and quantity pre-filled.
- Grouped or nested work appears as one operation with nest images.
- Live status board: who is working on what, the job's stage, and projected completion. Actual speed is compared against quoted times.
- Machine-monitoring integrations feed part counts, cycle times, and downtime. The API also models equipment downtime.

### Scheduling
- Finite-capacity auto-scheduler. Inputs: shifts per department, equipment capabilities, required equipment per operation, material availability, operation sequence, and estimated times.
- Generates a schedule in seconds, then lets planners drag and drop to override.
- Reschedules automatically when new orders arrive or priorities change. Changes push to operator screens.
- Rules batch similar work and reduce changeovers and overtime while protecting on-time delivery.
- What-if scenarios show downstream impact and cost.
- Backlog view shows load by department or equipment, used for bottleneck and growth analysis.
- Capacity feeds the delivery-date suggestions in quoting (CTP).

### Grouped work / nesting
- Group operations from many jobs into one shared operation, by operation type, sales order, or due date.
  - Used for cutting, and also for bending, powder coat, and paint to cut changeovers.
- The system suggests nest candidates across open orders, weighing due dates.
- Import nest output files from third-party nesting software: yields, run times, material, setups, and the nest image.
- Allocate machine time and sheet material in proportion across the parts and jobs in a nest. Predict remnants.
- One-step confirmation of nest completion posts good parts, remnants, and job costs.
- Quote-time DXF nesting gives estimate accuracy.

### Inventory & lots
- Real-time on-hand from receiving, consumption, production output, and shipments.
- Material views by type and shape, showing every stocked size including remnants.
  - The API has shape, grade, gauge, and material codes, so stock is dimensional.
- Multiple locations and sites. Valuation per location.
- Lot numbers generated automatically at receipt. Material certs attach to the lot or item.
- Lot genealogy: trace which lots were consumed by which job. Serial tracking is announced but not yet shipped.
- Cycle counts by export, edit, and re-import.
- Item record holds transactions, purchase history, BOM and routing, categories, classes, and tags.
- Customer-supplied material is tracked separately for valuation.

### Purchasing & planning
- Live buy recommendations from on-hand, open demand (jobs and sales orders), forecasted demand, minimum stock levels, and vendor lead times.
- Prioritized buyer to-do list grouped by material, so buyers can buy for many jobs at once. Recommendations combine into consolidated POs.
- Vendor master holds preferred vendors, pricing, and lead times. Vendors can be swapped or added at order time.
- Create a PO directly from a job.
- Supplier catalog integration (a large metals distributor) provides daily price, price-break, and lead-time sync, sends POs electronically, and returns delivery dates to planning.
- **Demand planning:** a projected inventory timeline recomputes on any order, job, or date change. Dashboards flag below-minimum items and timing issues (supply not ready for dependent work). Jobs are created from that list.
- Make-to-stock flag per item. Batch-size and minimum rules shape recommendations. Custom and stock work are mixed in one view.
- Outside processing (subcontract operations) was not covered on these pages.

### Receiving & shipping
- Receive at the dock against a PO. Print labels and scan to create the inventory record.
- Assign a lot at receipt. Attach mill certs, photos, notes, and timestamps. Route received material to the job that needs it.
- Shared log for receiving and purchasing covers late deliveries, vendor issues, and quality concerns.
- Shipping queue is prioritized. Completed jobs appear as ready to ship automatically.
- Shipments record photos, notes, timestamps, and problem flags, plus a shipment history.
- Packing labels exist (release video). Carrier rating and labels go through shipping integrations.
- A shipment notifies accounting to invoice, and shipping syncs with invoicing in real time.

### Quality
- AI auto-bubbling: detect dimensions, GD&T, and tolerances on drawings. A person confirms them and sets the measurement order, and the system learns from those choices.
- Bubbles become inspection characteristics tied to routing operations. Pass or fail color shows live as measurements come in.
- CMM results import (CSV) and map to characteristics automatically, traceable to the machine that captured them.
- Generate FAIR (AS9102-style), certificate of conformance, PPAP-style packets, and customer-format packets from production data.
  - Deliver by email, portal, or EDI. Export to a third-party FAI portal.
- NCR and CAPA linked to the job, operation, and operator, running from root cause to closure.
- Gauge and tool calibration records with e-signature and due-date alerts.
- Quality queue lists parts or revisions missing a quality plan, out-of-tolerance drift, missing checks, and jobs awaiting final review before ship.
- SPC-style live charts with trend alerts.
- Version-controlled document store on the floor (photos, certs, CMM files).
- Full audit trail per part: people, machines, measurements, movements. Lot quarantine and recall.

### Finance / invoicing
- Create invoices from sales order or shipment data, with prompts to invoice what has shipped. Download, print, or email.
- AR view lists unissued and unpaid invoices per customer, used to drive collections. AP view lists POs with cost.
- Two-way sync to an external accounting system for invoices, POs, and sales orders.
  - The ERP is not a general ledger. It keeps a chart of accounts and accounting codes for mapping.
- WIP and inventory valuation, plus COGS. Month-end exports: COGS, YTD invoices, uninvoiced shipments, inventory, WIP.
- Margin visible at each stage: quote, sales order, job, and the final actual against the sale price.
- Tax engine integrations, plus payment terms and refund reason codes.

### Reports / dashboards
- Prebuilt live reports and a custom report builder with saved charts. CSV export from any grid.
- Natural-language-to-chart generator.
- KPIs: throughput, makespan, dwell time, equipment utilization, operation time vs. estimate, scrap by value and quantity (heat map), and on-time status.
- Personnel view: who is clocked in and on what.
- Push data to BI tools and spreadsheets.

### AI assistant
- Chat over live shop data: due-soon jobs, true job cost, late vendors, and how-to questions.
- Takes actions: change a due date, add a note, update a record, create an invoice, draft a quote follow-up.
- App and dashboard builder: describe a page or automation in plain language and it is generated and hosted on live data.
- Event- or schedule-triggered agents are announced but not shipped. Planned examples:
  - drawing-to-quote
  - PO creation
  - overdue invoice chasing
  - margin watch on open jobs
  - monthly vendor scorecard
- Safety model: the assistant drafts and a human approves by default. Users can opt low-risk actions into auto-send.
- ITAR customers' models are hosted in a government cloud enclave.
- MCP server published alongside the REST API.

### Integrations / platform
- REST API plus MCP server. Custom fields, tags, alerts, tasks, and notes appear as API resource areas.
- Publicly listed API resource areas, as a high-level list only:
  - **Sales:** customers, quotes, sales orders.
  - **Production:** jobs, work orders, operations, work centers, equipment, departments and shifts.
  - **Floor tracking:** timers and time clock.
  - **Inventory:** items, inventory, lots, inventory transactions, locations and sites.
  - **Purchasing and logistics:** purchase orders, receiving, shipments, vendors.
  - **Quality and finance:** NCRs, CAPAs, tool calibration, invoices.
  - **Nesting:** nesting.
- Zapier, Slack, and Teams for event notifications. New integrations built on request.

## 2. Integrations named (names only)
- **Accounting:** QuickBooks Online, QuickBooks Desktop, Xero, NetSuite, Sage, SAP, Microsoft Dynamics, Acumatica
- **CAD/CAM:** SolidWorks, Fusion 360 (AutoCAD and Mastercam files also mentioned)
- **Nesting:** ProNest, Trumpf TruTops Boost, Radan/Radnest (Hexagon), Amada AMNEST, Bystronic BySoft, Messer, Cincinnati, Sigmanest, PEP Technology, Striker Systems, SecturaFAB
- **CRM:** HubSpot, Salesforce, Pipedrive, Insightly, Zoho, Copper
- **Ecommerce:** Shopify, BigCommerce, WooCommerce
- **Machine monitoring:** Datanomix, MachineMetrics, Amper
- **Shipping:** ShipStation, Shippo
- **Tax:** Avalara, TaxJar
- **Quoting/docs:** Paperless Parts, Radquote, PandaDoc
- **BI/analytics:** Power BI, Google Sheets, Mixpanel
- **Supplier:** Ryerson
- **Quality:** Net-Inspect, plus any CMM through CSV
- **Collaboration:** Microsoft Teams, Slack, Monday.com, Zapier
- **Infrastructure:** Azure Government / FedRAMP hosting for ITAR
- **Migration sources:** JobBOSS/E2, ProShop, Global Shop

## 3. YouTube topics by workflow
The channel lists about 135 videos. Only the newest ~30 titles were reachable through the public page and RSS feed. Older titles were not enumerated.
- **AI / custom apps:** builder that generates shop-specific pages and dashboards; AI assistant intro; AI answers for the shop floor.
- **Quality:** launch, walkthrough, and livestream of the quality module; aerospace and defense quality positioning; becoming an aerospace shop.
- **Purchasing:** live metals-supplier pricing and direct ordering inside a PO.
- **Migration/onboarding:** one-shot data transfer from a legacy job-shop ERP; deciding when to replace legacy processes.
- **Nesting/fabrication:** nesting workflows; workflows for custom sheet-metal shops; nesting estimates in quotes.
- **Scheduling/capacity:** using the backlog view to find bottlenecks.
- **Reporting:** custom report builder.
- **Release notes:**
  - "In 4" short updates: in-progress job edits, new material types, PO workflows, nesting estimates.
  - Packing labels, notifications, bulk record updates.
  - Monthly livestreams.
- **Customer stories / podcast:** a long-running interview series with shop owners (episodes 11-22: machine shops, fabricators, aerospace suppliers); founder talks on ERP, AI, and manufacturing.

## 4. Gaps / differentiation ideas
Items here were not mentioned, were announced but not shipped, or looked thin on the pages read.
- **Serialization:** announced as coming soon. Ship serial genealogy, as-built records, and unit-level history from day one.
- **Customer-specific quality templates:** not yet available. Offer configurable FAIR, CoC, and packet templates.
- **Outside processing / subcontract operations:** not covered. Cover routing steps sent to vendors (plating, heat treat) with ship-out and receive-back, vendor WIP, and cost.
- **Revision control:** barely marketed. Do strong part and drawing revision management, effectivity dates, ECO approval workflow, and "which revision did this job build".
- **Receiving inspection:** not on the shipping and receiving page. Add receiving inspection with sampling plans, supplier NCRs, RMAs, and return-to-vendor.
- **Packing and shipping depth:** packing slips, partial shipments, backorders, and multi-box packing were not described. Add native carrier labels and tracking-number push to customers.
- **Native CRM:** relies on external CRMs. Add a lightweight native pipeline: RFQ inbox, quote win/loss reasons, quote versioning, and price breaks by quantity.
- **Quote intelligence:** win-rate analytics, auto-price from historical actuals, and similar-part search.
- **Labor:** no shop-floor kiosk login detail, labor rates by skill, payroll export, or attendance/PTO. Add crew (multi-operator) timers and concurrent machine tending.
- **Maintenance:** equipment downtime exists only through the API and integrations. Add preventive maintenance on equipment, plus OEE built from that data.
- **Offline floor clients:** offline-tolerant tracking for poor shop Wi-Fi.
- **Tooling:** tool crib, tool life, and fixture inventory.
- **Cost transparency:** explicit overhead and burden rates per work center, standard vs. actual variance analysis, and landed cost on receipts.
- **Agentic AI:** their agents are not shipped. Ship event-driven automations with an approval inbox, full audit of AI actions, and per-role permission scopes.
- **Customer collaboration:** portal-based quote acceptance, customer PO upload, drawing markup and approval, and inbound EDI 850/855/856/810.
- **Multi-site and multi-currency:** not discussed. Plan for multi-entity, currency, and inter-site transfers.
- **Built-in light accounting option** for small shops that do not want a separate accounting tool.
- **Scheduling depth:** finite scheduling of labor skills, tooling constraints, and alternate work centers. Publish schedule-accuracy metrics.
- **Transparent pricing and self-serve trial:** both are demo-gated today.
- **Open data:** an open warehouse export (for example Parquet or SQL replica) beyond CSV and Power BI.
