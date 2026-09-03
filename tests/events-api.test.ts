import { describe, it, expect, beforeAll } from "vitest";

/* ============================================================
   The API surface, exercised through the real route handlers.

   Next route handlers are just functions of Request, so this runs
   them directly — no server, no port, no contention with anything
   else using the tree. Everything below is the code that would run
   in production, with an in-memory store behind it.
   ============================================================ */

// must be set before the store is first constructed
process.env.COVERS_DB = ":memory:";
process.env.COVERS_ORG = "org-test";

let events: typeof import("../app/api/events/route");
let decision: typeof import("../app/api/breaks/decision/route");

beforeAll(async () => {
  events = await import("../app/api/events/route");
  decision = await import("../app/api/breaks/decision/route");
});

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const anEvent = (summary: string) => ({
  type: "break.decision",
  at: "2026-09-03T03:56:00.000Z",
  actor: "Leanne Vidal",
  summary,
});

describe("POST /api/events", () => {
  it("appends and returns the chained event", async () => {
    const res = await events.POST(post("http://x/api/events", anEvent("first")));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.event.seq).toBe(0);
    expect(body.event.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an event missing its required fields", async () => {
    const res = await events.POST(post("http://x/api/events", { type: "break.decision" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/);
  });

  it("returns 200 rather than an error when a clientRef is replayed", async () => {
    const one = await events.POST(post("http://x/api/events", { ...anEvent("dup"), clientRef: "ref-1" }));
    const two = await events.POST(post("http://x/api/events", { ...anEvent("dup"), clientRef: "ref-1" }));
    expect(one.status).toBe(201);
    expect(two.status).toBe(200);
    const a = await one.json();
    const b = await two.json();
    expect(b.created).toBe(false);
    expect(b.event.seq).toBe(a.event.seq);
  });
});

describe("GET /api/events", () => {
  it("returns the chain and its head", async () => {
    const res = await events.GET(new Request("http://x/api/events"));
    const body = await res.json();
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.head.seq).toBe(body.events.at(-1).seq);
  });

  it("honours the since cursor, which is what an SSE reconnect uses", async () => {
    const all = await (await events.GET(new Request("http://x/api/events"))).json();
    const from = all.events[0].seq;
    const res = await events.GET(new Request(`http://x/api/events?since=${from}`));
    const body = await res.json();
    expect(body.events.every((e: { seq: number }) => e.seq > from)).toBe(true);
  });
});

describe("POST /api/breaks/decision", () => {
  const valid = {
    subject: "did:web:idara.app:w:darie-roberts",
    name: "Darie Roberts",
    kind: "meal",
    at: "2026-09-03T03:56:00.000Z",
    actor: "Leanne Vidal",
    overdue: true,
  };

  it("records the decision even with no Connecteam write configured", async () => {
    const res = await decision.POST(post("http://x/api/breaks/decision", valid));
    expect(res.status).toBe(201);
    const body = await res.json();
    // no break-type ids in env, so the push is skipped — but the decision stands,
    // and the response says which, so the UI need not imply a timesheet update
    expect(body.pushed).toBe("skipped");
    expect(body.decision.type).toBe("break.decision");
    expect(body.decision.summary).toContain("overdue");
  });

  it("rejects a malformed break kind", async () => {
    const res = await decision.POST(post("http://x/api/breaks/decision", { ...valid, kind: "coffee" }));
    expect(res.status).toBe(400);
  });

  it("rejects a decision with no actor — the log must be able to say who", async () => {
    const { actor: _actor, ...noActor } = valid;
    const res = await decision.POST(post("http://x/api/breaks/decision", noActor));
    expect(res.status).toBe(400);
  });

  it("does not double-send on a retried request", async () => {
    const withRef = { ...valid, clientRef: "phone-retry-1" };
    const a = await decision.POST(post("http://x/api/breaks/decision", withRef));
    const b = await decision.POST(post("http://x/api/breaks/decision", withRef));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await b.json()).created).toBe(false);
  });

  it("leaves the chain verifiable after everything above", async () => {
    const res = await events.GET(new Request("http://x/api/events"));
    const { events: log } = await res.json();
    const { verifyChain } = await import("../lib/idara/audit");
    expect(verifyChain(log)).toEqual({ ok: true, brokenAt: null });
  });
});
