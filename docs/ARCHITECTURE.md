# Ironline ERP — System architecture

Ironline is a multi-tenant SaaS for job shops and discrete manufacturers (CNC machining,
sheet metal, fabrication, assembly). It runs the order-to-cash and plan-to-produce loop:
quote → sales order → job → schedule → shop floor → inventory → quality → ship → invoice,
with live costing and reports on top and an AI assistant that can answer questions about
the shop's data.

"Ironline" is a working name (see `ASSUMPTIONS.md`); every user-facing string comes from
one config value so the product can be renamed.

## 1. Technology choices and why

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for the API, the browser and shared rules. The quote-pricing formula runs in both places (live preview in the browser, authoritative result on the server) from one source file. Largest hiring pool for SaaS work. |
| Runtime | **Node.js 26** | Already installed; mature, fast enough for a CRUD-heavy ERP. CPU-heavy jobs (scheduling solver, nesting) can move to a worker or a Rust service later without changing the API. |
| API framework | **Fastify 5** | Fast, schema-first, good plugin model for auth/tenancy hooks, first-class TypeScript. |
| Validation | **Zod 4** in `packages/shared` | Same schemas validate forms in the browser and requests on the server. |
| Database | **PostgreSQL 16** | Already running locally. Transactions, `numeric` for money, row-level security for tenant isolation, JSONB for custom fields, full-text search, `LISTEN/NOTIFY` for live screens. |
| Data access | **Drizzle ORM** + SQL migrations (drizzle-kit) | Typed queries that stay close to SQL; migrations are plain reviewable SQL files. |
| Auth | Email + password (**argon2id**), opaque session tokens in an `HttpOnly; SameSite=Lax` cookie, stored hashed | Simple, revocable, no JWT pitfalls. SSO (OIDC/SAML) added in a later phase. |
| Web app | **React 19 + Vite + React Router 7 + TanStack Query** | Standard, fast dev loop, cache-aware data fetching for live screens. |
| Styling | **Tailwind CSS 4** with our own design tokens and component set | Original look; light and dark themes; responsive down to tablets on the shop floor. |
| Tests | **Vitest** (API tests against a real `ironline_test` database), Playwright for browser flows | ERP bugs hide in data and transactions; mocks would hide them. |
| AI assistant | Hosted LLM API with tool use (read-only tools first) | Answers questions such as "which jobs are late and why" by calling our own API functions with the user's permissions. Product name for the assistant is our own. |
| Background jobs | `pg-boss` (Postgres-backed queue) | Scheduling runs, emails, PDF rendering, report snapshots, without adding Redis. |
| Files | S3-compatible storage (local disk in dev) | Drawings, CAD files, certificates, inspection photos. |
| PDFs | Server-rendered HTML → PDF (Playwright/Chromium) | Quotes, packing slips, invoices, travelers with the customer's branding. |

## 2. Repository layout (npm workspaces)

```
ironline-erp/
  apps/
    api/        Fastify server: routes, services, db schema, migrations, tests
    web/        React single-page app
  packages/
    shared/     Zod schemas, enums, pricing and costing maths, number formats
  docs/         this design, module and database specs, roadmap, assumptions
```

## 3. Tenancy and security

- **One database, shared tables, `org_id` on every tenant row.** Each request resolves the
  session → user → org, and every service function receives a `Ctx { orgId, userId, role }`.
  Queries are always filtered by `ctx.orgId`; no route touches the database without a `Ctx`.
- **Defense in depth (phase 2):** Postgres row-level security policies on every tenant table
  using `current_setting('app.org_id')`, set per transaction. A missed filter in code then
  returns nothing instead of another shop's data.
- **Roles:** owner, admin, estimator, planner, operator, quality, purchasing, accounting,
  viewer. Permissions are checked per route (`requireRole`). Shop-floor operators get a
  kiosk mode (badge/PIN login on a shared tablet) in phase 3.
- **Audit:** every status change and every edit of a commercial document writes an
  `events` row (who, when, what changed). Inventory and labor are append-only ledgers.
- Passwords hashed with argon2id; session tokens are 32 random bytes, only their SHA-256 is
  stored; login is rate-limited; CSRF is blocked by `SameSite` cookies plus an
  `Origin` check on state-changing requests.

## 4. How the modules fit together

```
            CRM (customers, contacts, opportunities)
                         │
   Items / BOM / Routing ┼──► Quoting ──► Sales orders ──► Jobs (work orders)
          ▲              │                     │               │
          │              │                     │      operations on work centers
     Purchasing ◄── Planning (MRP) ◄───────────┘               │
          │                                         Scheduling ┤ Shop floor (labor, scrap)
   Receiving ──► Inventory ledger (lots, locations) ◄──────────┤ material issue
                         │                                     │
                     Quality (inspections, NCRs) ◄─────────────┘
                         │
                     Shipping ──► Invoicing ──► Accounting export
                         │
        Reports, dashboards, AI assistant read across everything
```

Rules that keep modules consistent:
1. **Documents flow forward by conversion**, never by re-typing: a quote line becomes a
   sales-order line, which becomes a job; the job keeps a link back to both. Prices are
   copied (frozen) at conversion; costs are tracked live on the job.
2. **Quantities on hand are derived** from the inventory transaction ledger; nothing
   edits an on-hand number directly.
3. **Cost roll-up** = material issued + labor logged × work-center rate + outside
   services, compared with the quoted estimate per job and per operation.
4. **Service layer owns business rules** (status transitions, numbering, conversions);
   routes are thin. The AI assistant calls the same service functions.

## 5. API style

- REST + JSON under `/api/v1/...`, resources named in plural (`/customers`, `/quotes/:id`).
- Lists support `?q=` search, `?status=`, cursor pagination (`?after=`), and sorting.
- Commands that change state are explicit sub-resources: `POST /quotes/:id/send`,
  `POST /quotes/:id/convert`, `POST /jobs/:id/release`.
- Errors: `{ error: { code, message, fields? } }` with proper HTTP status.
- Public API keys and webhooks for integrations come in phase 4, reusing the same routes.

## 6. Environments and ports

| Thing | Dev value |
|---|---|
| API | `http://127.0.0.1:4100` |
| Web (Vite) | `http://127.0.0.1:5180`, proxies `/api` to the API |
| Database | `postgres:///ironline_dev` (local socket, OS user), tests use `ironline_test` |

Port 8787 belongs to the forex backtester and is not used here.
