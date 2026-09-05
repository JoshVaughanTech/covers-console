import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { signInOperator, asCaller, type TestSession } from "./sign-in-helper";
import { OPERATORS } from "../lib/auth/operators";

/* The stream carries the chain to an operator and a bare sequence number to a
   worker, so these tests have to say which they are. */
let op: TestSession;
const asOp = (url: string, init?: RequestInit) => asCaller(op, url, init);

/* ============================================================
   The SSE stream's lifecycle.

   The interesting cases are all about the client going away.
   controller.enqueue() throws once a stream is closed, and the
   subscriber is invoked from a microtask inside the store — so an
   unguarded write after a disconnect is an UNCAUGHT throw, not a
   catchable one. React Strict Mode mounts twice in development, so
   every page load disconnects a stream: this is the common path,
   not a rare one.
   ============================================================ */

/* No database to point at any more: with no DATABASE_URL the store opens an
   in-process Postgres, and vitest gives each test FILE its own worker, so
   these routes get a database nobody else is writing to. Cases within one
   file do share it — the ones that care set their own org or clientRef. */
process.env.COVERS_ORG = "org-stream";

let stream: typeof import("../app/api/events/stream/route");
let store: import("../lib/store/events").EventStore;

const ORG = "org-stream";

const ev = (n: number) => ({
  type: "break.decision" as const,
  at: "2026-09-03T03:56:00.000Z",
  actor: "Leanne Vidal",
  summary: `event ${n}`,
});

beforeAll(async () => {
  op = (await signInOperator(OPERATORS[0].did));
  stream = await import("../app/api/events/stream/route");
  store = await (await import("../lib/store/events")).eventStore();
});

/** Any unhandled rejection here is the bug this file exists to catch. */
const unhandled: unknown[] = [];
process.on("unhandledRejection", (e) => unhandled.push(e));
afterEach(() => { expect(unhandled).toEqual([]); });

async function readFrames(res: Response, count: number, ms = 1500): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const frames: string[] = [];
  const deadline = Date.now() + ms;
  let buf = "";
  while (frames.length < count && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const part of buf.split("\n\n")) {
      if (part.includes("data:")) frames.push(part);
    }
    buf = "";
  }
  reader.releaseLock();
  return frames;
}

describe("replay on connect", () => {
  it("sends what the client missed before going live", async () => {
    (await store.append(ORG, ev(1)));
    (await store.append(ORG, ev(2)));

    const res = await stream.GET(asOp("http://x/api/events/stream?since=-1"));
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const frames = await readFrames(res, 2);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    // the id: line is what a reconnect sends back as Last-Event-ID
    expect(frames[0]).toMatch(/^id: 0\n/);
  });

  it("honours a cursor so a reconnect does not replay everything", async () => {
    const res = await stream.GET(asOp("http://x/api/events/stream?since=0"));
    const frames = await readFrames(res, 1);
    expect(frames[0]).toMatch(/^id: 1\n/);
  });

  it("reads the cursor from Last-Event-ID, which is what EventSource sends", async () => {
    const res = await stream.GET(
      asOp("http://x/api/events/stream", { headers: { "last-event-id": "0" } }),
    );
    const frames = await readFrames(res, 1);
    expect(frames[0]).toMatch(/^id: 1\n/);
  });
});

describe("when the client goes away", () => {
  it("does not throw when an event arrives after a disconnect", async () => {
    const ctl = new AbortController();
    const res = await stream.GET(asOp("http://x/api/events/stream", { signal: ctl.signal }));
    await readFrames(res, 1, 400);

    ctl.abort();
    await new Promise((r) => setTimeout(r, 50));

    // the append that would previously have thrown from inside a microtask
    await expect(store.append(ORG, ev(99))).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    // afterEach asserts nothing was left unhandled
  });

  it("survives many connect/disconnect cycles, as Strict Mode produces", async () => {
    for (let i = 0; i < 10; i++) {
      const ctl = new AbortController();
      const res = await stream.GET(asOp("http://x/api/events/stream", { signal: ctl.signal }));
      await readFrames(res, 1, 200);
      ctl.abort();
    }
    await new Promise((r) => setTimeout(r, 50));

    // appends still work and the chain is untouched by all that churn
    await expect(store.append(ORG, ev(100))).resolves.not.toThrow();
    expect((await store.verify(ORG)).ok).toBe(true);
  });

  it("handles a request that is already aborted before the stream starts", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const res = await stream.GET(asOp("http://x/api/events/stream", { signal: ctl.signal }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    await expect(store.append(ORG, ev(101))).resolves.not.toThrow();
  });
});
