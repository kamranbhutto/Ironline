import { buildApp } from "./app.ts";
import { initPreviews } from "./services/files.ts";
import { autoFinish } from "./services/floor.ts";
import { refreshAllOpenOrders } from "./services/salesOrders.ts";
import { createDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";

const { db } = createDb();
await runMigrations(db);
const app = buildApp(db, { logger: true });
// Prepare 3D views for CAD files uploaded earlier or interrupted by a restart.
const previews = initPreviews(db, (m) => app.log.info(m));
await previews.resume();
const port = Number(process.env.PORT ?? 4100);
// Orders whose jobs all finished before orders followed their jobs become "ready to ship".
await refreshAllOpenOrders(db).catch((e) => app.log.error(e, "order status refresh failed"));
// Timers at work centers set to stop or finish at the planned time end on time, even with no screen open.
setInterval(() => {
  autoFinish(db).catch((e) => app.log.error(e, "auto-finish of timers failed"));
}, 15_000).unref();
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
