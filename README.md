# Ironline ERP

Shop-management software for job shops and manufacturers: quoting, sales orders, jobs,
shop floor, scheduling, quality, inventory, purchasing and reports, with shipping,
invoicing and an AI assistant on the roadmap. Multi-tenant SaaS: many shops share one
installation, each sees only its own data.

"Ironline" is a working name; change it in `packages/shared/src/brand.ts`.

## Design documents
| File | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | Technology choices and why, tenancy, security, how modules connect |
| `docs/MODULES.md` | Every module: records, workflows, dependencies, phase |
| `docs/DATABASE.md` | Table design, conventions, indexes |
| `docs/ROADMAP.md` | Build order in four phases |
| `docs/ASSUMPTIONS.md` | Decisions made without asking |
| `docs/research/competitor-capabilities.md` | Paraphrased public feature research |

## Run it locally
Needs Node.js 22+ and PostgreSQL 16 (local socket access for your OS user).

```bash
createdb ironline_dev && createdb ironline_test
npm install
cp apps/api/.env.example apps/api/.env
npm run db:migrate              # create tables
npm run db:seed -w @ironline/api # optional demo shop, see apps/api/src/db/seed.ts for its log-in
npm run dev                     # API on :4100, web app on http://127.0.0.1:5180
```

Checks:
```bash
npm test                        # shared unit tests + API tests on ironline_test
npm run typecheck
npm run build                   # production web build in apps/web/dist
```

## Layout
```
apps/api        Fastify + Drizzle + PostgreSQL (services hold the business rules)
apps/web        React + Vite + Tailwind single-page app
packages/shared Validation schemas and shared maths (pricing, tolerances, purchase planning, reports)
```

## Status
**Built and tested**
- Shops, users, roles, data isolation, audit log, document numbering, global search
- Customers and contacts; work centers with rates
- Parts with routing, BOM, and **drawings and 3D models** (STEP/IGES/STL/OBJ/GLB/3MF in 3D
  with section, measure and standard views; DXF flat patterns with size and cut length; PDF
  and images)
- Quotes with live costing; won quote → sales order → jobs. One-off quote lines become real
  parts, so their files and routing follow them
- Jobs: stage track, estimate vs actual cost tiles, files & 3D inherited from the part and
  quote, cost by operation, activity log, operations with progress, materials picked
- **Shop floor:** work-center queues; operator screen with setup/run/labor timers, good and
  scrap counts, material pick and return, operation hand-off; live actual cost on the job
- **Schedule board:** a column per work center with backlog hours, clear-by date and job cards
- **Quality:** numbered balloons on part drawings (PDF/image), tolerances and sampling per
  routing step; operators record readings on the floor; Cpk and spread per job; printable
  first-article inspection report; shop-wide quality page
- **Inventory:** lots and locations, receiving with material certificates, FIFO picking that
  costs jobs from lot costs, remnants, adjust and move, transaction history, traceability,
  spreadsheet (CSV) stock take
- **Purchasing:** buying plan from job demand, stock and reorder points; vendor baskets into
  purchase orders; receiving into lots; vendors with lead times and prices
- **Reports:** charts and tables over sales, jobs, quotes, labor, inspection, stock and
  purchases; saved reports; pin to the home dashboard
- Light and dark themes, phone and tablet layouts

See `docs/FEATURES.md` for the full checklist and `docs/ROADMAP.md` for the order of work.
Next: shipping, invoicing, non-conformance reports and nesting.

## Third-party notices
STEP/IGES/BREP files are read in the browser by `occt-import-js` (LGPL-2.1, built on Open
CASCADE Technology). It is loaded unmodified as a separate file and can be replaced; its
licence texts are in `node_modules/occt-import-js/dist/`. Other libraries are MIT-licensed.
