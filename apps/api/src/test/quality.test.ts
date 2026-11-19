import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, shop } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => env.close());

describe("quality", () => {
  it("plans balloons on a part, copies them to the job, judges readings and locks the plan", async () => {
    const { call, upload } = await shop(env.app);
    const other = await shop(env.app, "Other Shop");
    const mill = await call("POST", "/work-centers", { code: "MILL", name: "Mill", hourlyRate: 100 });
    const part = await call("POST", "/items", {
      partNumber: "QA-1",
      description: "Spacer",
      routing: [{ workCenterId: mill.body.id, setupHours: 1, runHoursPerUnit: 0.1 }],
    });
    expect(part.status).toBe(201);
    const drawing = await upload("item", part.body.id, "spacer.pdf", "%PDF-1.4 test");
    const plan = {
      characteristics: [
        { number: 1, kind: "diameter", attachmentId: drawing.body.id, x: 0.4, y: 0.3, nominal: 12, tolPlus: 0.02, tolMinus: 0.02, operationSeq: 10, sampling: "every_n", everyN: 5 },
        { number: 2, kind: "note", requirement: "Deburr all edges", sampling: "first" },
      ],
    };
    // Bad plans are refused.
    expect((await call("PUT", `/items/${part.body.id}/inspection-plan`, { characteristics: [plan.characteristics[0], plan.characteristics[0]] })).status).toBe(400);
    expect((await call("PUT", `/items/${part.body.id}/inspection-plan`, { characteristics: [{ number: 1, kind: "length" }] })).status).toBe(400);
    const saved = await call("PUT", `/items/${part.body.id}/inspection-plan`, plan);
    expect(saved.status).toBe(200);
    expect(saved.body).toHaveLength(2);
    expect((await other.call("GET", `/items/${part.body.id}/inspection-plan`)).status).toBe(404);

    const cust = await call("POST", "/customers", { name: "QA Customer" });
    const quote = await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ itemId: part.body.id, description: "Spacer", quantity: 10 }] });
    const order = await call("POST", `/quotes/${quote.body.id}/convert`, {});
    const so = await call("GET", `/sales-orders/${order.body.id}`);
    const jobId = so.body.lines[0].jobs[0].id;

    const insp = await call("GET", `/jobs/${jobId}/inspection`);
    expect(insp.body.characteristics.map((c: { number: number }) => c.number)).toEqual([1, 2]);
    const [dia, note] = insp.body.characteristics;
    expect(dia.due).toEqual([1, 5, 10]);
    expect(dia.operation.workCenter).toBe("Mill");
    expect([dia.lower, dia.upper]).toEqual([11.98, 12.02]);

    // The server judges numbers itself, whatever the client claims.
    const r1 = await call("POST", `/jobs/${jobId}/inspection/readings`, {
      piece: 1,
      readings: [{ characteristicId: dia.id, value: 12.05, passed: true }, { characteristicId: note.id, passed: true }],
    });
    expect(r1.status).toBe(200);
    expect(r1.body.results.find((r: { characteristicId: string }) => r.characteristicId === dia.id).passed).toBe(false);
    await call("POST", `/jobs/${jobId}/inspection/readings`, { piece: 5, readings: [{ characteristicId: dia.id, value: 12.01 }] });
    const r3 = await call("POST", `/jobs/${jobId}/inspection/readings`, { piece: 10, readings: [{ characteristicId: dia.id, value: 12 }] });
    const d = r3.body.characteristics[0];
    expect(d.count).toBe(3);
    expect(d.failures).toBe(1);
    expect(typeof d.cpk).toBe("number");
    // Correcting a reading overwrites it; an empty reading removes it.
    await call("POST", `/jobs/${jobId}/inspection/readings`, { piece: 1, readings: [{ characteristicId: dia.id, value: 12.0 }] });
    const fixed = await call("POST", `/jobs/${jobId}/inspection/readings`, { piece: 10, readings: [{ characteristicId: dia.id, value: null }] });
    expect(fixed.body.characteristics[0].failures).toBe(0);
    expect(fixed.body.characteristics[0].count).toBe(2);
    // Limits and ownership.
    expect((await call("POST", `/jobs/${jobId}/inspection/readings`, { piece: 11, readings: [{ characteristicId: dia.id, value: 12 }] })).status).toBe(400);
    expect((await call("POST", `/jobs/${jobId}/inspection/readings`, { piece: 2, readings: [{ characteristicId: dia.id }] })).status).toBe(200);
    expect((await other.call("POST", `/jobs/${jobId}/inspection/readings`, { piece: 1, readings: [{ characteristicId: dia.id, value: 12 }] })).status).toBe(404);
    // With readings on it, the job's plan is locked.
    expect((await call("POST", `/jobs/${jobId}/inspection/plan`)).status).toBe(409);

    const ov = await call("GET", "/quality/overview");
    expect(ov.body.plans[0].balloons).toBe(2);
    expect(ov.body.counts.total).toBe(3);
  });
});
