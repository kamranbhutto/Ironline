import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, shop } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => env.close());

describe("reports", () => {
  it("serves every dataset, saves reports and keeps shops apart", async () => {
    const { call } = await shop(env.app);
    const other = await shop(env.app, "Other Reports");
    const ds = await call("GET", "/reports/datasets");
    expect(ds.body.length).toBeGreaterThanOrEqual(7);
    // Every dataset query runs (empty shop).
    for (const d of ds.body) {
      const r = await call("GET", `/reports/datasets/${d.key}`);
      expect(r.status, d.key).toBe(200);
      expect(r.body.columns.length).toBeGreaterThan(0);
    }
    expect((await call("GET", "/reports/datasets/nope")).status).toBe(404);

    const view = { name: "By month", chart: "bar", values: [{ field: "line_total", agg: "sum" }], groupBy: { field: "order_date", bucket: "month" } };
    expect((await call("POST", "/reports", { name: "Bad", dataset: "sales_lines", config: { views: [{ ...view, values: [{ field: "drop table", agg: "sum" }] }] } })).status).toBe(400);
    const saved = await call("POST", "/reports", { name: "Monthly sales", dataset: "sales_lines", config: { views: [view] }, pinned: true });
    expect(saved.status).toBe(201);
    expect((await call("GET", "/reports/pinned")).body).toHaveLength(1);
    expect((await other.call("GET", `/reports/${saved.body.id}`)).status).toBe(404);
    expect((await other.call("GET", "/reports")).body).toHaveLength(0);
    expect((await call("DELETE", `/reports/${saved.body.id}`)).status).toBe(204);
  });
});
