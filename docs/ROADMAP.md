# Ironline ERP — Development roadmap

Every module ships as: database migration → service functions with business rules →
API routes → web pages → automated tests. A phase is done when its workflow runs end to
end in the browser and the tests pass.

## Phase 1 — Foundation and the order spine
1. Monorepo, database migrations, test setup, dev scripts. 
2. Sign-up (new shop + owner), log-in, sessions, roles, app shell with navigation, light/dark theme.
3. CRM: customers and contacts.
4. Work centers with rates; items with routing and BOM.
5. Quoting with operations, materials, outside services, markup and live cost breakdown.
6. Quote → sales order conversion; sales orders.
7. Sales order line → job with operations and materials copied over; job list and job page.
8. Audit events and per-org document numbering.

## Phase 2 — Running the shop
9. Inventory ledger, locations, lots; issue material to jobs; finished goods.
10. Shop-floor kiosk: start/stop labor, quantities, scrap; live job costing (estimate vs actual).
11. Purchasing: vendors, POs (materials and outside services), receiving with lots.
12. Quality: inspections, NCRs, dispositions, CAPA, certificates.
13. Shipping: packing slips, shipments, partial shipments; invoicing and payments.
14. Planning (MRP suggestions) and finite-capacity scheduling board; grouped work.
15. Dashboards and report builder; PDF quotes/travelers/invoices; e-mail sending.
16. Row-level security, user invitations, password reset, shop switcher for users in
    several shops (log-in currently picks one), shared rate limiting (Postgres/Redis
    instead of in memory; set `trustProxy` only behind a known proxy; off in tests).

## Phase 3 — Intelligence and depth
17. AI assistant: read-only tools, then confirmed drafting actions (RFQ → quote, drawing → routing).
18. Capable-to-promise dates on quotes; schedule what-ifs.
19. Revision control and approvals; custom fields; attachments and drawing viewer.
20. Kiosk badge login, tablet layout, offline-tolerant labor entry.

## Phase 4 — Commercial SaaS
21. Billing and subscription plans, trial sign-up, org admin console.
22. Public API with keys, webhooks; QuickBooks/Xero sync; CSV import of master data.
23. Customer portal (view quotes, accept, order status, documents).
24. SSO, data export, backups, monitoring, multi-region hosting.

## Status
See the bottom of `README.md` for what is built so far.
