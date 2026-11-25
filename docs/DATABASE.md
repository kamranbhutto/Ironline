# Ironline ERP — Database design

PostgreSQL 16. Phase-1 tables are implemented in `apps/api/src/db/schema.ts` and its
migrations; the rest is the target design that later phases follow.

## Conventions (apply to every table)
- Primary key `id uuid default gen_random_uuid()`.
- Tenant tables have `org_id uuid not null references organizations` and every unique
  key includes `org_id` (e.g. `unique (org_id, number)`).
- Money: `numeric(14,4)`; quantities: `numeric(14,4)`; hours: `numeric(10,4)`; rates and
  percentages: `numeric(9,4)`. Stored as exact `numeric`, never `float`. The API reads them
  into JavaScript numbers, and every stored cost and price is rounded by
  `packages/shared/src/pricing.ts` first (4 decimals for costs, 2 for prices).
- Times: `timestamptz`; plain dates (due dates) as `date`.
- `created_at`, `updated_at`, `created_by`, `updated_by` on business records.
- Status columns are `text` checked against a fixed list in code and a `check` constraint.
- Document numbers come from `number_sequences (org_id, kind, prefix, next_value)`,
  incremented with `UPDATE … RETURNING` inside the same transaction as the insert.
- Deleting business documents is replaced by status `cancelled`/`archived`; ledgers
  (inventory, labor, events) are append-only.
- Phase 2: row-level security on every tenant table: `org_id = current_setting('app.org_id')::uuid`.

## Entity relationships (the spine)

```
organizations 1─* memberships *─1 users
organizations 1─* customers 1─* contacts
customers 1─* quotes 1─* quote_lines 1─* quote_line_operations, quote_line_materials
quote_lines ─► sales_order_lines (converted_from)
customers 1─* sales_orders 1─* sales_order_lines 1─* jobs
items 1─* bom_lines, routing_operations
jobs 1─* job_operations *─1 work_centers
jobs 1─* job_materials *─1 items
job_operations 1─* labor_entries *─1 users
items 1─* inventory_transactions *─1 locations, lots
sales_order_lines 1─* shipment_lines *─1 shipments
shipments 1─* invoice_lines *─1 invoices
```

## Phase 1 tables

| Table | Key columns |
|---|---|
| `organizations` | name, slug (unique), currency (ISO 4217), timezone, settings jsonb |
| `users` | email (unique, lower-case), name, password_hash |
| `memberships` | org_id, user_id, role; unique (org_id, user_id) |
| `sessions` | token_hash (unique), user_id, org_id, expires_at |
| `number_sequences` | org_id, kind (`quote`,`sales_order`,`job`,…), prefix, next_value |
| `events` | org_id, entity, entity_id, action, data jsonb, user_id, created_at |
| `customers` | org_id, code (unique per org), name, status (`prospect`,`active`,`inactive`), email, phone, website, payment_terms_days, billing/shipping address jsonb, notes |
| `contacts` | org_id, customer_id, name, title, email, phone, is_primary |
| `work_centers` | org_id, code, name, kind (`machine`,`labor`,`outside`), hourly_rate, setup_rate, capacity_hours_per_day, active |
| `items` | org_id, part_number (unique per org), revision, description, type (`manufactured`,`purchased`,`material`,`service`), uom, unit_cost, sale_price, active |
| `routing_operations` | org_id, item_id, sequence, work_center_id, description, setup_hours, run_hours_per_unit |
| `bom_lines` | org_id, parent_item_id, component_item_id, quantity_per, scrap_pct |
| `quotes` | org_id, number, revision, customer_id, contact_id, status, valid_until, lead_time_days, notes, terms, totals (price, cost) cached on save |
| `quote_lines` | org_id, quote_id, line_no, item_id (nullable for one-off parts), description, quantity, markup_pct, unit_price_override, computed unit_cost/unit_price |
| `quote_line_operations` | org_id, quote_line_id, sequence, work_center_id, description, setup_hours, run_hours_per_unit, rate |
| `quote_line_materials` | org_id, quote_line_id, item_id (nullable), description, quantity_per, unit_cost, scrap_pct |
| `quote_line_services` (outside) | folded into `quote_line_materials` with `kind='service'` and `per_lot` flag in phase 1 |
| `sales_orders` | org_id, number, customer_id, quote_id, customer_po, status, order_date, ship_to jsonb, notes |
| `sales_order_lines` | org_id, sales_order_id, line_no, quote_line_id, item_id, description, quantity, unit_price, due_date, quantity_shipped |
| `jobs` | org_id, number, sales_order_line_id, item_id, description, quantity, quantity_completed, due_date, priority, status, estimated_cost (frozen from quote) |
| `job_operations` | org_id, job_id, sequence, work_center_id, description, setup_hours, run_hours_per_unit, rate, status, quantity_good, quantity_scrap |
| `job_materials` | org_id, job_id, item_id, description, quantity_required, unit_cost, quantity_issued |

## Phase 2+ tables (target design)

| Table | Key columns |
|---|---|
| `locations` | org_id, code, name, kind (`stock`,`receiving`,`wip`,`shipping`,`quarantine`) |
| `lots` | org_id, item_id, lot_number, serial (bool), received_at, vendor_lot, expires_at, cert attachment |
| `inventory_transactions` | org_id, item_id, lot_id, location_id, kind (`receipt`,`issue`,`return`,`produce`,`ship`,`adjust`,`transfer_in`,`transfer_out`,`scrap`), quantity (signed), unit_cost, job_id, po_line_id, shipment_line_id, user_id, created_at |
| `inventory_balances` (view / materialised) | sum of the ledger by org, item, lot, location |
| `allocations` | org_id, item_id, lot_id, job_material_id or shipment_line_id, quantity |
| `labor_entries` | org_id, job_operation_id, user_id, kind (`setup`,`run`,`rework`), started_at, ended_at, quantity_good, quantity_scrap, scrap_reason, rate snapshot |
| `downtime_entries` | org_id, work_center_id, reason, started_at, ended_at |
| `calendars`, `shifts`, `calendar_exceptions` | working hours per work center |
| `schedule_slots` | org_id, job_operation_id, work_center_id, starts_at, ends_at, locked, run_id |
| `operation_groups` | grouped work across jobs: org_id, work_center_id, name, status; `operation_group_members (group_id, job_operation_id, cost_share)` |
| `vendors`, `vendor_items` | vendor details, lead times, price breaks |
| `purchase_orders`, `purchase_order_lines` | linked to item or job_operation (outside service) |
| `receipts`, `receipt_lines` | create lots and `receipt` transactions |
| `inspection_plans`, `inspection_characteristics`, `inspection_results` | nominal, tolerance, method, gauge, measured value, pass/fail |
| `ncrs` | org_id, number, source (receipt/job/customer), item_id, lot_id, quantity, defect, disposition, status |
| `capas`, `gauges`, `gauge_calibrations` | corrective actions and calibration records |
| `shipments`, `shipment_lines`, `packages` | carrier, tracking, ship date, lots shipped |
| `invoices`, `invoice_lines`, `payments`, `credit_notes`, `tax_rates` | AR |
| `forecasts` | org_id, item_id, period, quantity (demand planning) |
| `attachments` | org_id, entity, entity_id, file key, name, mime, size |
| `custom_field_defs` + `custom jsonb` columns on main records | shop-specific fields |
| `saved_reports`, `dashboards` | report builder definitions |
| `ai_conversations`, `ai_messages`, `ai_tool_calls` | assistant history and audit of every tool call |
| `api_keys`, `webhooks`, `webhook_deliveries` | integrations |

## Important indexes
- `(org_id, status)` on quotes, sales orders, jobs, POs, NCRs, invoices.
- `(org_id, customer_id)` on quotes, sales orders, invoices.
- `(org_id, item_id, location_id, lot_id)` on `inventory_transactions`.
- `(org_id, work_center_id, starts_at)` on `schedule_slots`.
- Trigram/full-text indexes on customer name, item part number and description (search box).

## Additions from competitor research (to build in phase 2)
These came out of `docs/research/competitor-capabilities.md` and change the target design:
- **Estimated and actual cost per operation** — already on `job_operations`
  (`estimated_cost`, `actual_hours`, `actual_cost`); labor entries roll up into them.
- **Grouped work / nesting** — `operation_groups` + `operation_group_members` with a
  `cost_share` per member, and `remnants` returned to stock as new sized lots.
- **Dimensional stock** — `lots` gain `shape`, `grade`, `gauge`, `length`, `width` so plate,
  sheet and bar remnants can be tracked and reused.
- **Outside processing** — `job_operations.kind = 'outside'` linked to a purchase-order line,
  with ship-out / receive-back status.
- **Part revisions and change orders** — `item_revisions` (approved, effective date) and
  `change_orders`; quotes and jobs point at a specific revision.
- **Capable-to-promise** — schedule snapshots (`schedule_runs`) so a quote can ask
  "earliest date if accepted today" without changing the live schedule.
- **AI actions** — `ai_actions` (proposed change, status: proposed / approved / rejected,
  approver) so every assistant change is reviewed and logged.

## Quality tables (migration 0004)

- `inspection_characteristics` — the part's plan: one row per balloon (`item_id`, `number`
  unique per part, `kind`, `attachment_id` + `page` + `x`/`y` as 0–1 fractions, `nominal`,
  `tol_plus`, `tol_minus`, `unit`, `datums`, `requirement`, `operation_seq`, `sampling`
  first/every_n/all, `every_n`, `gauge`, `critical`). Rewritten as a whole on save.
- `job_characteristics` — the job's copy of the plan, same columns, made at job creation.
- `inspection_results` — one reading per balloon per piece (`piece`, `value`, `passed`,
  `gauge`, `user_id`, `recorded_at`), unique on (characteristic, piece); saving again
  overwrites, an empty reading deletes.

## Inventory tables (migration 0005)

- `stock_locations` — code (unique per shop), name, active.
- `stock_lots` — item, location, `lot_number` (L-00001…), `dimensions` (text label),
  `heat_number`, `supplier`, `quantity` (cache of its ledger, never below zero), `unit_cost`,
  `remnant`, `parent_lot_id`, `received_at`. Certificates are attachments with entity
  `stock_lot`.
- `stock_transactions` — the ledger: item, lot (null = untracked), `kind` (receive, consume,
  return, remnant, adjust, count, move_out, move_in), signed `quantity`, `unit_cost`, `value`,
  job and job material, `source_type`/`source_id` for Purchasing, note, user, time.
- `items.reorder_point`, `items.reorder_quantity`; `job_materials.issued_cost` (job material
  actual cost; back-filled from quantity × unit cost).

## Purchasing tables (migration 0006)

- `vendors` — name (unique per shop), email, phone, address, payment terms, notes, active.
- `item_vendors` — item × vendor with `is_primary` (at most one per item, partial unique
  index), `lead_days`, `unit_cost`, `min_order`, `vendor_part_number`.
- `purchase_orders` — `number` (PO-00001…), vendor, `status` draft/sent/partial/received/
  cancelled, `order_date`, notes, `total`.
- `purchase_order_lines` — item (nullable for free text), description, quantity, unit cost,
  due date, `quantity_received`, `job_material_id` (reserved for outside services).
- Receipts are `stock_transactions` with `source_type = 'purchase_order'` and `source_id` =
  the line id.

## Reports table (migration 0007)

- `reports` — name, `dataset` (one of the fixed datasets in `services/reports.ts`), `config`
  (views: chart, values, group by, split, filters, hidden columns, order, limit, stacked),
  `starred`, `pinned`, created/updated by and at. Columns used in a report are checked
  against the dataset when saving.

## Packaging (migration 0009)

- `items` gains `pack_l`, `pack_w`, `pack_h` (mm), `pack_weight` (kg), `pack_upright`,
  `pack_nest_pitch`, `pack_settings` (the last study's inputs) and `pack_spec` (the chosen
  container, counts per container / pallet / truck and cost per part, shown on jobs).
- `pack_assets` — the shop's library: `kind` (carton, tote, crate, pallet, vehicle), unique
  `code`, name, inside size (footprint and deck height for pallets), wall, tare, max load or
  payload, pallet max height, price, returnable with trip cost and life in trips, and the
  board grade for cartons.

## Work center timing (migration 0010)

- `work_centers.at_planned_time` — `continue` (default), `stop` or `complete`: what a running
  timer does when the step's planned time is reached.
