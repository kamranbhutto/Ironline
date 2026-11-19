import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError, type ZodType } from "zod";
import {
  contactSchema,
  convertQuoteSchema,
  customerSchema,
  itemSchema,
  jobStatusSchema,
  loginSchema,
  quoteSchema,
  signupSchema,
  workCenterSchema,
} from "@ironline/shared";
import type { Db } from "./db/client.ts";
import { badRequest, HttpError, type Ctx } from "./ctx.ts";
import * as auth from "./services/auth.ts";
import * as crm from "./services/customers.ts";
import * as inv from "./services/items.ts";
import * as jobsSvc from "./services/jobs.ts";
import * as quotesSvc from "./services/quotes.ts";
import * as so from "./services/salesOrders.ts";
import { search } from "./services/search.ts";
import * as files from "./services/files.ts";
import * as floor from "./services/floor.ts";
import * as messages from "./services/messages.ts";
import * as quality from "./services/quality.ts";
import * as inventory from "./services/inventory.ts";
import * as purchasing from "./services/purchasing.ts";
import * as reportsSvc from "./services/reports.ts";

export const COOKIE = "ironline_session";

declare module "fastify" {
  interface FastifyRequest {
    ctx: Ctx | null;
  }
}

const parse = <T>(schema: ZodType<T>, value: unknown): T => schema.parse(value ?? {});
const idParam = z.object({ id: z.uuid() });
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().max(30).optional(),
  type: z.string().max(30).optional(),
  customerId: z.uuid().optional(),
});

/** Simple fixed-window limiter for log-in and sign-up attempts (per IP). */
function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.until < now) {
      hits.set(key, { n: 1, until: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
      return;
    }
    if (process.env.NODE_ENV === "test") return;
    if (++h.n > max) throw new HttpError(429, "rate_limited", "Too many attempts. Wait a few minutes and try again.");
  };
}

export function buildApp(db: Db, opts: { logger?: boolean; secureCookies?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  app.register(cookie);
  app.register(multipart, { limits: { fileSize: files.MAX_FILE_BYTES, files: 1 } });
  app.decorateRequest("ctx", null);
  const limitAuth = rateLimiter(20, 15 * 60_000);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of err.issues) fields[issue.path.join(".") || "_"] = issue.message;
      return reply.status(400).send({ error: { code: "invalid", message: "Please check the highlighted fields", fields } });
    }
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, fields: err.fields } });
    }
    // Postgres unique violation (e.g. two people saving the same code at once).
    if ((err as { code?: string }).code === "23505") {
      return reply.status(409).send({ error: { code: "conflict", message: "A record with this number or code already exists" } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: "bad_request", message: (err as Error).message } });
    }
    app.log.error(err);
    return reply.status(500).send({ error: { code: "server_error", message: "Something went wrong on the server" } });
  });

  // Block cross-site form posts: a state-changing request must come from our own origin.
  app.addHook("onRequest", async (req) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      throw new HttpError(403, "bad_origin", "Request blocked: wrong origin");
    }
  });

  app.addHook("preHandler", async (req) => {
    const token = req.cookies[COOKIE];
    req.ctx = token ? await auth.ctxFromToken(db, token) : null;
  });

  const ctxOf = (req: FastifyRequest): Ctx => {
    if (!req.ctx) throw new HttpError(401, "unauthenticated", "Please log in");
    return req.ctx;
  };

  const setSession = (reply: FastifyReply, s: { token: string; expiresAt: Date }) =>
    reply.setCookie(COOKIE, s.token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: opts.secureCookies ?? process.env.NODE_ENV === "production",
      expires: s.expiresAt,
    });

  const api = "/api/v1";

  app.get("/health", async () => ({ ok: true }));

  // ── Auth ──
  app.post(`${api}/auth/signup`, async (req, reply) => {
    limitAuth(`signup:${req.ip}`);
    const s = await auth.signup(db, parse(signupSchema, req.body));
    setSession(reply, s);
    return reply.status(201).send(await auth.me(db, { orgId: s.orgId, userId: s.userId, role: "owner" }));
  });
  app.post(`${api}/auth/login`, async (req, reply) => {
    limitAuth(`login:${req.ip}`);
    const s = await auth.login(db, parse(loginSchema, req.body));
    setSession(reply, s);
    const ctx = await auth.ctxFromToken(db, s.token);
    return auth.me(db, ctx!);
  });
  app.post(`${api}/auth/logout`, async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await auth.logout(db, token);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
  app.get(`${api}/auth/me`, async (req) => auth.me(db, ctxOf(req)));

  app.get(`${api}/dashboard`, async (req) => so.dashboard(db, ctxOf(req)));
  app.get(`${api}/search`, async (req) => search(db, ctxOf(req), parse(listQuery, req.query).q ?? ""));

  // ── CRM ──
  app.get(`${api}/customers`, async (req) => crm.listCustomers(db, ctxOf(req), parse(listQuery, req.query)));
  app.post(`${api}/customers`, async (req, reply) =>
    reply.status(201).send(await crm.createCustomer(db, ctxOf(req), parse(customerSchema, req.body))),
  );
  app.get(`${api}/customers/:id`, async (req) => crm.getCustomer(db, ctxOf(req), parse(idParam, req.params).id));
  app.patch(`${api}/customers/:id`, async (req) =>
    crm.updateCustomer(db, ctxOf(req), parse(idParam, req.params).id, parse(customerSchema.partial(), req.body)),
  );
  app.post(`${api}/customers/:id/contacts`, async (req, reply) =>
    reply.status(201).send(await crm.addContact(db, ctxOf(req), parse(idParam, req.params).id, parse(contactSchema, req.body))),
  );
  app.patch(`${api}/contacts/:id`, async (req) =>
    crm.updateContact(db, ctxOf(req), parse(idParam, req.params).id, parse(contactSchema.partial(), req.body)),
  );
  app.delete(`${api}/contacts/:id`, async (req, reply) => {
    await crm.deleteContact(db, ctxOf(req), parse(idParam, req.params).id);
    return reply.status(204).send();
  });

  // ── Work centers and items ──
  app.get(`${api}/work-centers`, async (req) => inv.listWorkCenters(db, ctxOf(req)));
  app.post(`${api}/work-centers`, async (req, reply) =>
    reply.status(201).send(await inv.createWorkCenter(db, ctxOf(req), parse(workCenterSchema, req.body))),
  );
  app.patch(`${api}/work-centers/:id`, async (req) =>
    inv.updateWorkCenter(db, ctxOf(req), parse(idParam, req.params).id, parse(workCenterSchema.partial(), req.body)),
  );
  app.get(`${api}/items`, async (req) => inv.listItems(db, ctxOf(req), parse(listQuery, req.query)));
  app.post(`${api}/items`, async (req, reply) =>
    reply.status(201).send(await inv.createItem(db, ctxOf(req), parse(itemSchema, req.body))),
  );
  app.get(`${api}/items/:id`, async (req) => inv.getItem(db, ctxOf(req), parse(idParam, req.params).id));
  app.put(`${api}/items/:id`, async (req) =>
    inv.updateItem(db, ctxOf(req), parse(idParam, req.params).id, parse(itemSchema, req.body)),
  );

  // ── Quotes ──
  app.get(`${api}/quotes`, async (req) => quotesSvc.listQuotes(db, ctxOf(req), parse(listQuery, req.query)));
  app.post(`${api}/quotes`, async (req, reply) =>
    reply.status(201).send(await quotesSvc.createQuote(db, ctxOf(req), parse(quoteSchema, req.body))),
  );
  app.get(`${api}/quotes/:id`, async (req) => quotesSvc.getQuote(db, ctxOf(req), parse(idParam, req.params).id));
  app.put(`${api}/quotes/:id`, async (req) =>
    quotesSvc.updateQuote(db, ctxOf(req), parse(idParam, req.params).id, parse(quoteSchema, req.body)),
  );
  const quoteAction = z.object({ id: z.uuid(), action: z.enum(["send", "reopen", "lose", "cancel"]) });
  app.post(`${api}/quotes/:id/:action`, async (req, reply) => {
    const raw = req.params as { action?: string };
    if (raw.action === "convert") {
      const order = await quotesSvc.convertQuote(db, ctxOf(req), parse(idParam, req.params).id, parse(convertQuoteSchema, req.body));
      return reply.status(201).send(order);
    }
    const p = parse(quoteAction, req.params);
    return quotesSvc.changeQuoteStatus(db, ctxOf(req), p.id, p.action);
  });

  // ── Sales orders and jobs ──
  app.get(`${api}/sales-orders`, async (req) => so.listSalesOrders(db, ctxOf(req), parse(listQuery, req.query)));
  app.get(`${api}/sales-orders/:id`, async (req) => so.getSalesOrder(db, ctxOf(req), parse(idParam, req.params).id));
  app.post(`${api}/sales-order-lines/:id/jobs`, async (req, reply) =>
    reply.status(201).send(await jobsSvc.createJobFromOrderLine(db, ctxOf(req), parse(idParam, req.params).id)),
  );
  app.get(`${api}/jobs`, async (req) => jobsSvc.listJobs(db, ctxOf(req), parse(listQuery, req.query)));
  app.get(`${api}/jobs/:id`, async (req) => jobsSvc.getJob(db, ctxOf(req), parse(idParam, req.params).id));
  app.post(`${api}/jobs/:id/status`, async (req) =>
    jobsSvc.setJobStatus(db, ctxOf(req), parse(idParam, req.params).id, parse(jobStatusSchema, req.body).status),
  );

  // ── Files ──
  const fileQuery = z.object({ entity: z.string(), entityId: z.uuid() });
  const entityOf = (v: string) => {
    if (!files.isEntity(v)) throw badRequest("Unknown record type");
    return v;
  };
  app.get(`${api}/files`, async (req) => {
    const q = parse(fileQuery, req.query);
    return files.listFiles(db, ctxOf(req), entityOf(q.entity), q.entityId);
  });
  app.post(`${api}/files`, async (req, reply) => {
    const q = parse(fileQuery, req.query);
    const ctx = ctxOf(req);
    const part = await req.file();
    if (!part) throw badRequest("Choose a file to upload");
    return reply.status(201).send(await files.saveUpload(db, ctx, entityOf(q.entity), q.entityId, part));
  });
  app.get(`${api}/files/:id`, async (req, reply) => {
    const { row, stream } = await files.openFile(db, ctxOf(req), parse(idParam, req.params).id);
    const download = (req.query as { download?: string }).download === "1";
    reply.header("content-type", row.mime);
    reply.header("content-length", row.size);
    reply.header("cache-control", "private, max-age=3600");
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-disposition", `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`);
    return reply.send(stream);
  });
  app.get(`${api}/files/:id/preview`, async (req, reply) => {
    const { size, stream } = await files.openPreview(db, ctxOf(req), parse(idParam, req.params).id);
    reply.header("content-type", "model/gltf-binary");
    reply.header("content-length", size);
    reply.header("cache-control", "private, max-age=86400");
    reply.header("x-content-type-options", "nosniff");
    return reply.send(stream);
  });
  app.delete(`${api}/files/:id`, async (req, reply) => {
    await files.deleteFile(db, ctxOf(req), parse(idParam, req.params).id);
    return reply.status(204).send();
  });

  // ── Shop floor ──
  app.get(`${api}/floor/work-centers`, async (req) => floor.floorWorkCenters(db, ctxOf(req)));
  app.get(`${api}/floor/board`, async (req) => floor.board(db, ctxOf(req)));
  app.get(`${api}/floor/work-centers/:id/queue`, async (req) => floor.queue(db, ctxOf(req), parse(idParam, req.params).id));
  app.get(`${api}/floor/operations/:id`, async (req) => floor.operationView(db, ctxOf(req), parse(idParam, req.params).id));
  app.post(`${api}/floor/operations/:id/start`, async (req) => {
    const id = parse(idParam, req.params).id;
    await floor.startTimer(db, ctxOf(req), id, parse(floor.startSchema, req.body).kind);
    return floor.operationView(db, ctxOf(req), id);
  });
  app.post(`${api}/floor/operations/:id/stop`, async (req) => {
    const id = parse(idParam, req.params).id;
    await floor.stopTimer(db, ctxOf(req), id, parse(floor.stopSchema, req.body));
    return floor.operationView(db, ctxOf(req), id);
  });
  app.post(`${api}/floor/operations/:id/complete`, async (req) =>
    floor.completeOperation(db, ctxOf(req), parse(idParam, req.params).id, parse(floor.stopSchema, req.body)),
  );
  app.post(`${api}/floor/operations/:id/count`, async (req) => {
    const id = parse(idParam, req.params).id;
    await floor.countParts(db, ctxOf(req), id, parse(floor.countSchema, req.body));
    return floor.operationView(db, ctxOf(req), id);
  });
  app.post(`${api}/floor/operations/:id/rework`, async (req) => {
    const id = parse(idParam, req.params).id;
    await floor.reworkParts(db, ctxOf(req), id, parse(floor.reworkSchema, req.body));
    return floor.operationView(db, ctxOf(req), id);
  });
  app.get(`${api}/jobs/:id/messages`, async (req) => messages.listMessages(db, ctxOf(req), parse(idParam, req.params).id));
  app.post(`${api}/jobs/:id/messages`, async (req, reply) =>
    reply.status(201).send(await messages.postMessage(db, ctxOf(req), parse(idParam, req.params).id, parse(messages.messageSchema, req.body))),
  );
  app.post(`${api}/floor/materials/:id/pick`, async (req) =>
    floor.pickMaterial(db, ctxOf(req), parse(idParam, req.params).id, parse(floor.pickSchema, req.body).quantity),
  );
  app.patch(`${api}/jobs/:id`, async (req) =>
    jobsSvc.updateJob(db, ctxOf(req), parse(idParam, req.params).id, parse(jobsSvc.jobUpdateSchema, req.body)),
  );

  app.get(`${api}/items/:id/inspection-plan`, async (req) => quality.getPlan(db, ctxOf(req), parse(idParam, req.params).id));
  app.put(`${api}/items/:id/inspection-plan`, async (req) =>
    quality.savePlan(db, ctxOf(req), parse(idParam, req.params).id, parse(quality.planSchema, req.body)),
  );
  app.get(`${api}/jobs/:id/inspection`, async (req) => quality.jobInspection(db, ctxOf(req), parse(idParam, req.params).id));
  app.post(`${api}/jobs/:id/inspection/plan`, async (req) => quality.refreshJobPlan(db, ctxOf(req), parse(idParam, req.params).id));
  app.post(`${api}/jobs/:id/inspection/readings`, async (req) =>
    quality.recordReadings(db, ctxOf(req), parse(idParam, req.params).id, parse(quality.readingsSchema, req.body)),
  );
  app.get(`${api}/quality/overview`, async (req) => quality.overview(db, ctxOf(req)));

  app.get(`${api}/inventory`, async (req) => inventory.overview(db, ctxOf(req), parse(z.object({ q: z.string().optional() }), req.query)));
  app.get(`${api}/inventory/locations`, async (req) => inventory.listLocations(db, ctxOf(req)));
  app.post(`${api}/inventory/locations`, async (req, reply) => reply.status(201).send(await inventory.saveLocation(db, ctxOf(req), parse(inventory.locationSchema, req.body))));
  app.put(`${api}/inventory/locations/:id`, async (req) => inventory.saveLocation(db, ctxOf(req), parse(inventory.locationSchema, req.body), parse(idParam, req.params).id));
  app.post(`${api}/inventory/receive`, async (req, reply) => reply.status(201).send(await inventory.receive(db, ctxOf(req), parse(inventory.receiveSchema, req.body))));
  app.get(`${api}/inventory/items/:id`, async (req) => inventory.itemStock(db, ctxOf(req), parse(idParam, req.params).id));
  app.put(`${api}/inventory/items/:id/reorder`, async (req) => inventory.setReorder(db, ctxOf(req), parse(idParam, req.params).id, parse(inventory.reorderSchema, req.body)));
  app.post(`${api}/inventory/lots/:id/adjust`, async (req) => inventory.adjustLot(db, ctxOf(req), parse(idParam, req.params).id, parse(inventory.adjustSchema, req.body)));
  app.post(`${api}/inventory/lots/:id/move`, async (req) => inventory.moveLot(db, ctxOf(req), parse(idParam, req.params).id, parse(inventory.moveSchema, req.body)));
  app.get(`${api}/inventory/stock-take`, async (req) => inventory.stockTakeRows(db, ctxOf(req)));
  app.post(`${api}/inventory/stock-take`, async (req) => inventory.stockTake(db, ctxOf(req), parse(inventory.countSchema, req.body)));
  app.post(`${api}/floor/materials/:id/remnant`, async (req, reply) =>
    reply.status(201).send(await inventory.saveRemnant(db, ctxOf(req), parse(idParam, req.params).id, parse(inventory.remnantSchema, req.body))),
  );

  app.get(`${api}/vendors`, async (req) => purchasing.listVendors(db, ctxOf(req)));
  app.post(`${api}/vendors`, async (req, reply) => reply.status(201).send(await purchasing.saveVendor(db, ctxOf(req), parse(purchasing.vendorSchema, req.body))));
  app.get(`${api}/vendors/:id`, async (req) => purchasing.getVendor(db, ctxOf(req), parse(idParam, req.params).id));
  app.put(`${api}/vendors/:id`, async (req) => purchasing.saveVendor(db, ctxOf(req), parse(purchasing.vendorSchema, req.body), parse(idParam, req.params).id));
  app.get(`${api}/items/:id/vendors`, async (req) => purchasing.getItemVendors(db, ctxOf(req), parse(idParam, req.params).id));
  app.put(`${api}/items/:id/vendors`, async (req) => purchasing.setItemVendors(db, ctxOf(req), parse(idParam, req.params).id, parse(purchasing.itemVendorsSchema, req.body)));
  const endQ = z.object({ endDate: z.iso.date().optional() });
  app.get(`${api}/purchasing/plan`, async (req) => purchasing.plan(db, ctxOf(req), parse(endQ, req.query)));
  app.get(`${api}/purchasing/plan/:id`, async (req) => purchasing.planDetail(db, ctxOf(req), parse(idParam, req.params).id, parse(endQ, req.query)));
  app.get(`${api}/purchase-orders`, async (req) => purchasing.listOrders(db, ctxOf(req), parse(z.object({ status: z.string().optional(), vendorId: z.uuid().optional() }), req.query)));
  app.post(`${api}/purchase-orders`, async (req, reply) => reply.status(201).send(await purchasing.createOrder(db, ctxOf(req), parse(purchasing.poSchema, req.body))));
  app.get(`${api}/purchase-orders/:id`, async (req) => purchasing.getOrder(db, ctxOf(req), parse(idParam, req.params).id));
  app.put(`${api}/purchase-orders/:id`, async (req) => purchasing.updateOrder(db, ctxOf(req), parse(idParam, req.params).id, parse(purchasing.poSchema, req.body)));
  app.post(`${api}/purchase-orders/:id/status`, async (req) => purchasing.setOrderStatus(db, ctxOf(req), parse(idParam, req.params).id, parse(purchasing.statusSchema, req.body)));
  app.post(`${api}/purchase-orders/:id/receive`, async (req) => purchasing.receiveOrder(db, ctxOf(req), parse(idParam, req.params).id, parse(purchasing.receiveSchema, req.body)));

  app.get(`${api}/reports/datasets`, async () => reportsSvc.listDatasets());
  app.get(`${api}/reports/datasets/:key`, async (req) => reportsSvc.datasetRows(db, ctxOf(req), parse(z.object({ key: z.string().max(40) }), req.params).key));
  app.get(`${api}/reports`, async (req) => reportsSvc.listReports(db, ctxOf(req)));
  app.get(`${api}/reports/pinned`, async (req) => reportsSvc.pinnedReports(db, ctxOf(req)));
  app.post(`${api}/reports`, async (req, reply) => reply.status(201).send(await reportsSvc.saveReport(db, ctxOf(req), parse(reportsSvc.reportSchema, req.body))));
  app.get(`${api}/reports/:id`, async (req) => reportsSvc.getReport(db, ctxOf(req), parse(idParam, req.params).id));
  app.put(`${api}/reports/:id`, async (req) => reportsSvc.saveReport(db, ctxOf(req), parse(reportsSvc.reportSchema, req.body), parse(idParam, req.params).id));
  app.patch(`${api}/reports/:id`, async (req) => reportsSvc.setFlags(db, ctxOf(req), parse(idParam, req.params).id, parse(reportsSvc.flagsSchema, req.body)));
  app.delete(`${api}/reports/:id`, async (req, reply) => (await reportsSvc.deleteReport(db, ctxOf(req), parse(idParam, req.params).id), reply.status(204).send()));

  return app;
}
