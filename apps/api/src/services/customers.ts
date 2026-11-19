import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { ContactInput, CustomerInput } from "@ironline/shared";
import type { Db } from "../db/client.ts";
import { contacts, customers, quotes, salesOrders } from "../db/schema.ts";
import { conflict, EDITORS, notFound, requireRole, type Ctx } from "../ctx.ts";
import { like, logEvent, nextNumber } from "./common.ts";

const clean = <T extends { email?: string | null }>(input: T) => ({ ...input, email: input.email || null });

export async function listCustomers(db: Db, ctx: Ctx, opts: { q?: string; status?: string } = {}) {
  const where = [eq(customers.orgId, ctx.orgId)];
  if (opts.q) where.push(or(ilike(customers.name, like(opts.q)), ilike(customers.code, like(opts.q)))!);
  if (opts.status) where.push(eq(customers.status, opts.status));
  return db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      status: customers.status,
      email: customers.email,
      phone: customers.phone,
      openQuotes: sql<number>`(select count(*)::int from quotes q where q.customer_id = "customers"."id" and q.status in ('draft','sent'))`,
      openOrders: sql<number>`(select count(*)::int from sales_orders s where s.customer_id = "customers"."id" and s.status in ('confirmed','in_production'))`,
    })
    .from(customers)
    .where(and(...where))
    .orderBy(asc(customers.name))
    .limit(500);
}

export async function getCustomer(db: Db, ctx: Ctx, id: string) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, ctx.orgId), eq(customers.id, id)));
  if (!customer) throw notFound("Customer");
  const [contactRows, quoteRows, orderRows] = await Promise.all([
    db.select().from(contacts).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.customerId, id))).orderBy(desc(contacts.isPrimary), asc(contacts.name)),
    db
      .select({ id: quotes.id, number: quotes.number, revision: quotes.revision, status: quotes.status, totalPrice: quotes.totalPrice, createdAt: quotes.createdAt })
      .from(quotes)
      .where(and(eq(quotes.orgId, ctx.orgId), eq(quotes.customerId, id)))
      .orderBy(desc(quotes.createdAt))
      .limit(50),
    db
      .select({ id: salesOrders.id, number: salesOrders.number, status: salesOrders.status, totalPrice: salesOrders.totalPrice, orderDate: salesOrders.orderDate })
      .from(salesOrders)
      .where(and(eq(salesOrders.orgId, ctx.orgId), eq(salesOrders.customerId, id)))
      .orderBy(desc(salesOrders.createdAt))
      .limit(50),
  ]);
  return { ...customer, contacts: contactRows, quotes: quoteRows, salesOrders: orderRows };
}

async function codeTaken(db: Db, ctx: Ctx, code: string, exceptId?: string) {
  const rows = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.orgId, ctx.orgId), eq(customers.code, code)));
  return rows.some((r) => r.id !== exceptId);
}

export async function createCustomer(db: Db, ctx: Ctx, input: CustomerInput) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    const code = input.code || (await nextNumber(tx, ctx.orgId, "customer"));
    if (await codeTaken(db, ctx, code)) throw conflict(`Customer code ${code} is already used`);
    const [row] = await tx
      .insert(customers)
      .values({ ...clean(input), code, orgId: ctx.orgId, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning();
    await logEvent(tx, ctx, "customer", row!.id, "created", { name: row!.name });
    return row!;
  });
}

export async function updateCustomer(db: Db, ctx: Ctx, id: string, input: Partial<CustomerInput>) {
  requireRole(ctx, EDITORS);
  if (input.code && (await codeTaken(db, ctx, input.code, id))) throw conflict(`Customer code ${input.code} is already used`);
  const [row] = await db
    .update(customers)
    .set({ ...clean(input), updatedAt: new Date(), updatedBy: ctx.userId })
    .where(and(eq(customers.orgId, ctx.orgId), eq(customers.id, id)))
    .returning();
  if (!row) throw notFound("Customer");
  return row;
}

export async function addContact(db: Db, ctx: Ctx, customerId: string, input: ContactInput) {
  requireRole(ctx, EDITORS);
  await getCustomer(db, ctx, customerId);
  return db.transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.update(contacts).set({ isPrimary: false }).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.customerId, customerId)));
    }
    const [row] = await tx
      .insert(contacts)
      .values({ ...input, email: input.email || null, customerId, orgId: ctx.orgId })
      .returning();
    return row!;
  });
}

export async function updateContact(db: Db, ctx: Ctx, id: string, input: Partial<ContactInput>) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(contacts).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.id, id)));
    if (!existing) throw notFound("Contact");
    if (input.isPrimary) {
      await tx.update(contacts).set({ isPrimary: false }).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.customerId, existing.customerId)));
    }
    const [row] = await tx
      .update(contacts)
      .set({ ...input, ...(input.email !== undefined ? { email: input.email || null } : {}), updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    return row!;
  });
}

export async function deleteContact(db: Db, ctx: Ctx, id: string) {
  requireRole(ctx, EDITORS);
  const rows = await db.delete(contacts).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.id, id))).returning({ id: contacts.id });
  if (!rows.length) throw notFound("Contact");
}
