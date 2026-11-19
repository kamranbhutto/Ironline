import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import type { LoginInput, Role, SignupInput } from "@ironline/shared";
import type { Db, Tx } from "../db/client.ts";
import { memberships, organizations, sessions, users } from "../db/schema.ts";
import { conflict, HttpError, type Ctx } from "../ctx.ts";

export const SESSION_DAYS = 30;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
// Used when the e-mail is unknown, so a failed log-in takes the same time either way.
const DUMMY_HASH = await hash("not-a-real-password-just-timing");

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "shop"}-${randomBytes(3).toString("hex")}`;
}

async function createSession(tx: Tx, userId: string, orgId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await tx.insert(sessions).values({ tokenHash: sha256(token), userId, orgId, expiresAt });
  return { token, expiresAt };
}

export async function signup(db: Db, input: SignupInput) {
  const passwordHash = await hash(input.password);
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing.length) throw conflict("An account with this e-mail already exists. Log in instead.");
    const [org] = await tx.insert(organizations).values({ name: input.orgName, slug: slugify(input.orgName) }).returning();
    const [user] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning();
    await tx.insert(memberships).values({ orgId: org!.id, userId: user!.id, role: "owner" });
    const session = await createSession(tx, user!.id, org!.id);
    return { ...session, userId: user!.id, orgId: org!.id };
  });
}

export async function login(db: Db, input: LoginInput) {
  const [user] = await db.select().from(users).where(eq(users.email, input.email));
  const ok = await verify(user?.passwordHash ?? DUMMY_HASH, input.password);
  if (!user || !ok) throw new HttpError(401, "bad_credentials", "Wrong e-mail or password");
  const [m] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (!m) throw new HttpError(403, "no_org", "This account is not a member of any shop");
  const session = await createSession(db, user.id, m.orgId);
  return { ...session, userId: user.id, orgId: m.orgId };
}

export async function logout(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** Resolve a session cookie to the acting user and shop, or null if invalid/expired. */
export async function ctxFromToken(db: Db, token: string): Promise<Ctx | null> {
  const [row] = await db
    .select({ userId: sessions.userId, orgId: sessions.orgId, role: memberships.role })
    .from(sessions)
    .innerJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.orgId, sessions.orgId)))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row ? { userId: row.userId, orgId: row.orgId, role: row.role as Role } : null;
}

export async function me(db: Db, ctx: Ctx) {
  const [row] = await db
    .select({
      user: { id: users.id, name: users.name, email: users.email },
      org: { id: organizations.id, name: organizations.name, currency: organizations.currency },
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, ctx.orgId))
    .where(eq(users.id, ctx.userId));
  return { ...row!, role: ctx.role };
}
