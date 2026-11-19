import { buildApp } from "./app.ts";
import { initPreviews } from "./services/files.ts";
import { createDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";

const { db } = createDb();
await runMigrations(db);
const app = buildApp(db, { logger: true });
// Prepare 3D views for CAD files uploaded earlier or interrupted by a restart.
const previews = initPreviews(db, (m) => app.log.info(m));
await previews.resume();
const port = Number(process.env.PORT ?? 4100);
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
