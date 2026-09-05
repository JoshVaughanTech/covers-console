import { describe, it, expect, beforeAll } from "vitest";

/* ============================================================
   The API surface, exercised through the real route handlers.

   Next route handlers are just functions of Request, so this runs
   them directly — no server, no port, no contention with anything
   else using the tree. Everything below is the code that would run
   in production, with an in-memory store behind it.
   ============================================================ */

/* No database to point at any more: with no DATABASE_URL the store opens an
   in-process Postgres, and vitest gives each test FILE its own worker, so
   these routes get a database nobody else is writing to. Cases within one
   file do share it — the ones that care set their own org or clientRef. */
process.env.COVERS_ORG = "org-test";

let events: typeof import("../app/api/events/route");
let decision: typeof import("../app/api/breaks/decision/route");

beforeAll(async () => {
  events = await import("../app/api/events/route");
  decision = await import("../app/api/breaks/decision/route");
  leanne = await signIn("did:web:idara.app:w:leanne-vidal");
  op = await signInOperator(OPERATORS[0].did);
});

import { signIn, signInOperator, asCaller, type TestSession } from "./sign-in-helper";
import { OPERATORS } from "../lib/auth/operators";

/* The chain is an operator surface now: it is the venue compliance record,
   and a worker reading it would see every colleague. */
let op: TestSession;

/* The break decision route takes the supervisor from the session now, so
   these go through a real sign-in rather than naming an actor in the body. */
let leanne: TestSession;
const asLeanne = (body: unknown) =>
  asCaller(leanne, "http://x/api/breaks/decision", { method: "POST", body: JSON.stringify(body) });

const asOperator = (body: unknown) =>
  asCaller(op, "http://x/api/events", { method: "POST", body: JSON.stringify(body) });

const asOperatorGet = (url: string) => asCaller(op, url);

/** Unauthenticated, for the routes that still take one. */
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
    const res = await events.POST(asOperator(anEvent("first")));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.event.seq).toBe(0);
    expect(body.event.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an event missing its required fields", async () => {
    const res = await events.POST(asOperator({ type: "break.decision" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/);
  });

  it("returns 200 rather than an error when a clientRef is replayed", async () => {
    const one = await events.POST(asOperator({ ...anEvent("dup"), clientRef: "ref-1" }));
    const two = await events.POST(asOperator({ ...anEvent("dup"), clientRef: "ref-1" }));
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
    const res = await events.GET(asOperatorGet("http://x/api/events"));
    const body = await res.json();
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.head.seq).toBe(body.events.at(-1).seq);
  });

  it("honours the since cursor, which is what an SSE reconnect uses", async () => {
    const all = await (await events.GET(asOperatorGet("http://x/api/events"))).json();
    const from = all.events[0].seq;
    const res = await events.GET(asOperatorGet(`http://x/api/events?since=${from}`));
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
    overdue: true,
    // no actor: the route takes it from the session, and a body that named
    // one would be describing a supervisor nobody checked
  };

  it("records the decision even with no Connecteam write configured", async () => {
    const res = await decision.POST(asLeanne(valid));
    expect(res.status).toBe(201);
    const body = await res.json();
    // no break-type ids in env, so the push is skipped — but the decision stands,
    // and the response says which, so the UI need not imply a timesheet update
    expect(body.pushed).toBe("skipped");
    expect(body.decision.type).toBe("break.decision");
    expect(body.decision.summary).toContain("overdue");
  });

  it("rejects a malformed break kind", async () => {
    const res = await decision.POST(asLeanne({ ...valid, kind: "coffee" }));
    expect(res.status).toBe(400);
  });

  it("refuses a decision from nobody — the log must be able to say who", async () => {
    /* This used to check that the body named an actor. A body can name
       anyone, so what it really checked was that the phone had filled in a
       field. Now the session says who, and a caller without one is refused. */
    const res = await decision.POST(post("http://x/api/breaks/decision", valid));
    expect(res.status).toBe(401);
  });

  it("attributes the decision to the session, not to anything the body says", async () => {
    const res = await decision.POST(asLeanne({ ...valid, actor: "Somebody Else", actorDid: "did:web:idara.app:w:nobody" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    // an unverifiable name is a weak record; an unverifiable DID that looks
    // verifiable is worse
    expect(body.decision.actor).toBe("Leanne Vidal");
    expect(body.decision.actorDid).toBe("did:web:idara.app:w:leanne-vidal");
  });

  it("does not double-send on a retried request", async () => {
    const withRef = { ...valid, clientRef: "phone-retry-1" };
    const a = await decision.POST(asLeanne(withRef));
    const b = await decision.POST(asLeanne(withRef));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await b.json()).created).toBe(false);
  });

  it("leaves the chain verifiable after everything above", async () => {
    const res = await events.GET(asOperatorGet("http://x/api/events"));
    const { events: log } = await res.json();
    const { verifyChain } = await import("../lib/idara/audit");
    expect(verifyChain(log)).toEqual({ ok: true, brokenAt: null });
  });
});
