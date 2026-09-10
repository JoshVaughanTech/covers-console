/* ============================================================
   Nobody's clock is read for a caller who will be refused.

   POST /api/engagements/confirm has two doors — a run token for
   the scheduled sweep, and an operator session for a venue
   confirming one shift. It used to fold the chain and call
   completedSessions() BEFORE trying either, and refuse afterwards.

   completedSessions() is not local. With a clock configured it is
   a request to Connecteam, so an unauthenticated POST spent the
   venue's rate limit against a third party and then answered 401.
   Nothing leaked — the response was the same either way — which is
   why it was invisible: the cost was the whole of it.

   /api is deliberately outside the middleware matcher ("those
   routes answer 401 in their own terms, which a fetch can act on
   and a redirect cannot"), so this endpoint is reachable by
   anybody who can resolve the host.

   The status codes were already right and are pinned here too,
   because moving the guard is exactly the kind of change that
   quietly loses the 404-for-a-bad-token distinction.
   ============================================================ */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventStore } from "../lib/store/events";
import { db, setDb } from "../lib/store/db";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

let store: EventStore;
let confirmRoute: typeof import("../app/api/engagements/confirm/route");

/** Enough for clockConfigured() to say yes, so completedSessions() would call out. */
const CLOCK_ENV = {
  CONNECTEAM_TIME_CLOCK_ID: "tc-1",
  CONNECTEAM_API_KEY: "k-1",
};

const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const [k, v] of Object.entries(CLOCK_ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  setDb(null);
  // EventStore migrates lazily inside each method; there is nothing to init
  store = new EventStore(await db());
  confirmRoute = await import("../app/api/engagements/confirm/route");
});

afterEach(async () => {
  for (const k of Object.keys(CLOCK_ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await store.close();
  setDb(null);
  vi.restoreAllMocks();
});

const post = (headers: Record<string, string> = {}) =>
  confirmRoute.POST(
    new Request("http://x/api/engagements/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ engagementId: "eng-whatever" }),
    }),
  );

describe("a caller who will be refused", () => {
  it("does not reach the venue's time clock", async () => {
    /* fetch is the seam Connecteam goes through, and the one push-delivery
       already spies on. A call here is a request the venue pays for, made on
       behalf of somebody with no session. */
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await post();

    expect(res.status).toBe(401);
    expect(
      fetchSpy,
      "the clock was read before the caller was refused — completedSessions() " +
        "must sit below the guard, not above it",
    ).not.toHaveBeenCalled();
  });

  it("does not read the chain either", async () => {
    // cheaper than the clock, but still work done for somebody with no session
    const all = vi.spyOn(EventStore.prototype, "all");
    const res = await post();
    expect(res.status).toBe(401);
    expect(all).not.toHaveBeenCalled();
  });

  it("still tells a bad token nothing, and a missing session the truth", async () => {
    /* The distinction predates this change and is easy to lose while moving a
       guard: a wrong token gets 404 so it learns nothing about whether the
       endpoint exists, and a browser with no session gets a 401 it can act on. */
    expect((await post({ "x-run-token": "not-the-token" })).status).toBe(404);
    expect((await post()).status).toBe(401);
  });

  it("answers the same whether or not the clock is configured", async () => {
    for (const k of Object.keys(CLOCK_ENV)) delete process.env[k];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await post()).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the guard is not the only thing standing", () => {
  it("leaves the chain empty — a refused call writes nothing", async () => {
    await post();
    await post({ "x-run-token": "not-the-token" });
    expect(await store.all(ORG)).toHaveLength(0);
  });
});
