import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, COOKIE } from "../app.ts";
import { createDb } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";

const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgresql:///ironline_test?host=/var/run/postgresql";

/** Fresh test database (schema dropped and migrated) and an app instance. */
export async function setupApp() {
  if (!/ironline_test/.test(TEST_URL)) throw new Error("Refusing to reset a database that is not ironline_test");
  const { db, pool } = createDb(TEST_URL);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await runMigrations(db);
  const app = buildApp(db);
  await app.ready();
  return { app, db, close: async () => (await app.close(), await pool.end()) };
}

let n = 0;
/** Sign up a new shop and return a client that sends its session cookie. */
export async function shop(app: FastifyInstance, name = "Acme Machining") {
  n += 1;
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { orgName: name, name: "Owner", email: `owner${n}-${Date.now()}@example.test`, password: "correct horse battery" },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === COOKIE)!;
  const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url: `/api/v1${url}`, payload: payload as object, cookies: { [COOKIE]: cookie.value } });
    return { status: r.statusCode, body: r.body ? r.json() : null };
  };
  /** Upload one file as multipart form data. */
  const upload = async (entity: string, entityId: string, filename: string, content: string) => {
    const boundary = "----ironline-test";
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/files?entity=${entity}&entityId=${entityId}`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      cookies: { [COOKIE]: cookie.value },
      payload,
    });
    return { status: r.statusCode, body: r.body ? r.json() : null };
  };
  const raw = (url: string) => app.inject({ method: "GET", url: `/api/v1${url}`, cookies: { [COOKIE]: cookie.value } });
  return { call, upload, raw, me: res.json() };
}
