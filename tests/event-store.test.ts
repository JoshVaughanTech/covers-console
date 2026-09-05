import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventStore } from "../lib/store/events";
import { verifyChain } from "../lib/idara/audit";
import { db, setDb } from "../lib/store/db";

/* ============================================================
   The event store.

   The property everything else rests on: appendEvent() derives seq
   and prevHash from the tail, which is a read-modify-write. Safe in
   one browser tab, a forked chain with two phones. The append runs
   inside BEGIN IMMEDIATE so contenders queue rather than both
   claiming the same position — and if that transaction is ever
   removed, the concurrency test below fails loudly.
   ============================================================ */

const ORG = "org-brightwater";
let store: EventStore;

const decision = (n: number) => ({
  type: "break.decision" as const,
  at: "2026-09-03T13:56:00.000Z",
  actor: "Leanne Vidal",
  summary: `sent person ${n} on meal break`,
  data: { n },
});

beforeEach(async () => { setDb(null); store = new EventStore(await db()); });
afterEach(async () => { await store.close(); setDb(null); });

describe("chaining", () => {
  it("starts at seq 0 and links each event to the last", async () => {
    const a = (await store.append(ORG, decision(1))).event;
    const b = (await store.append(ORG, decision(2))).event;
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(b.prevHash).toBe(a.hash);
    expect((await store.verify(ORG))).toEqual({ ok: true, brokenAt: null });
  });

  it("produces a chain the existing verifier accepts unchanged", async () => {
    for (let i = 0; i < 10; i++) (await store.append(ORG, decision(i)));
    // the same function the audit screen runs, over rows read back from storage
    expect(verifyChain((await store.all(ORG)))).toEqual({ ok: true, brokenAt: null });
  });

  it("keeps one chain per org", async () => {
    (await store.append(ORG, decision(1)));
    const other = (await store.append("org-other", decision(1))).event;
    expect(other.seq).toBe(0);
    expect((await store.head(ORG))!.seq).toBe(0);
    expect((await store.head("org-other"))!.seq).toBe(0);
  });

  it("a second store reads the first one's chain, not a new one", async () => {
    /* This was "survives reopening", closing a file and opening it again.
       Durability across a restart now belongs to the server, and an
       in-memory PGlite cannot demonstrate it either way — so the honest
       version of the property is the half that is still ours: a store is a
       view onto a database, not an owner of state, and a second one sees
       what the first wrote. */
    const d = await db();
    const one = new EventStore(d);
    await one.append(ORG, decision(1));
    await one.append(ORG, decision(2));
    const headBefore = await one.head(ORG);

    const two = new EventStore(d);
    expect(await two.head(ORG)).toEqual(headBefore);
    expect(await two.all(ORG)).toHaveLength(2);
    expect((await two.verify(ORG)).ok).toBe(true);
  });
});

describe("concurrency — the test the design exists for", () => {
  it("keeps the chain intact and gapless under many interleaved appends", async () => {
    const N = 200;
    // fired together rather than awaited in turn, so ordering is the store's
    // job and not the caller's
    await Promise.all(
      Array.from({ length: N }, (_, i) => Promise.resolve().then(() => store.append(ORG, decision(i)))),
    );

    const all = (await store.all(ORG));
    expect(all).toHaveLength(N);

    // no gaps, no duplicates: exactly 0..N-1, in order
    expect(all.map((e) => e.seq)).toEqual(Array.from({ length: N }, (_, i) => i));

    // every hash distinct — two events claiming one position would collide
    expect(new Set(all.map((e) => e.hash)).size).toBe(N);

    // and the chain still verifies end to end
    expect((await store.verify(ORG))).toEqual({ ok: true, brokenAt: null });
    expect((await store.head(ORG))).toEqual({ seq: N - 1, hash: all[N - 1].hash });
  });

  it("leaves nothing behind when an append fails mid-transaction", async () => {
    (await store.append(ORG, decision(1)));
    // an unserialisable payload throws inside the transaction
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify throws inside the transaction
    const bad = { ...decision(2), data: circular };
    await expect(store.append(ORG, bad)).rejects.toThrow();
    // the failed append must not have advanced the head or left a row
    expect((await store.all(ORG))).toHaveLength(1);
    expect((await store.head(ORG))!.seq).toBe(0);
    expect((await store.verify(ORG)).ok).toBe(true);
  });
});

describe("idempotency", () => {
  it("returns the original when a clientRef is replayed", async () => {
    const first = (await store.append(ORG, decision(1), { clientRef: "phone-abc" }));
    const again = (await store.append(ORG, decision(1), { clientRef: "phone-abc" }));

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.event.seq).toBe(first.event.seq);
    expect(again.event.hash).toBe(first.event.hash);
    expect((await store.all(ORG))).toHaveLength(1);
  });

  it("does not confuse refs across orgs", async () => {
    (await store.append(ORG, decision(1), { clientRef: "same-ref" }));
    const other = (await store.append("org-other", decision(1), { clientRef: "same-ref" }));
    expect(other.created).toBe(true);
  });

  it("still appends when no ref is given", async () => {
    (await store.append(ORG, decision(1)));
    (await store.append(ORG, decision(1)));
    expect((await store.all(ORG))).toHaveLength(2);
  });
});

describe("reading", () => {
  it("returns only what a client has not seen", async () => {
    for (let i = 0; i < 5; i++) (await store.append(ORG, decision(i)));
    // this is what Last-Event-ID maps onto after an SSE reconnect
    expect((await store.since(ORG, 2)).map((e) => e.seq)).toEqual([3, 4]);
    expect((await store.since(ORG, 4))).toHaveLength(0);
    expect((await store.since(ORG, -1))).toHaveLength(5);
  });

  it("records when an event was stored, separately from when it happened", async () => {
    // an offline decision keeps its real time; the store notes when it landed.
    // recordedAt is metadata, NOT a field on the event — putting it on the
    // event would change the object verifyChain re-hashes, and every event
    // would fail verification. That is the chain working, not a bug.
    const r = (await store.append(ORG, decision(1)));
    expect(r.event.at).toBe("2026-09-03T13:56:00.000Z");
    expect("recordedAt" in r.event).toBe(false);
    expect(Number.isNaN(Date.parse(r.recordedAt))).toBe(false);

    const meta = (await store.withMeta(ORG));
    expect(meta).toHaveLength(1);
    expect(meta[0].recordedAt).toBe(r.recordedAt);
    expect(meta[0].event.hash).toBe(r.event.hash);
  });
});

describe("subscriptions", () => {
  it("notifies listeners for its own org only", async () => {
    const seen: number[] = [];
    const off = store.subscribe(ORG, (e) => seen.push(e.seq));
    (await store.append(ORG, decision(1)));
    (await store.append("org-other", decision(1)));
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([0]);
    off();
    (await store.append(ORG, decision(2)));
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([0]);
  });
});
