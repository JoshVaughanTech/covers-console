import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventStore } from "../lib/store/events";
import { db, setDb } from "../lib/store/db";

/* ============================================================
   The chain, on Postgres.

   The properties that must survive the move off SQLite. Not "does
   it store rows" — that a database stores rows is not in doubt —
   but the two things BEGIN IMMEDIATE was doing: appends serialise,
   and a partial write never lands.

   The concurrency test below is honest about what it proves. PGlite
   is one connection, so it demonstrates that concurrent callers get
   distinct positions and a chain that verifies; it does not
   demonstrate that a real server serialises two connections. That
   rests on pg_advisory_xact_lock, which is reasoned rather than
   observed here, and is called out at the lock itself.
   ============================================================ */

const ORG = "org-test";
let store: EventStore;

beforeEach(async () => {
  setDb(null);
  store = new EventStore(await db());
});
afterEach(async () => {
  await store.close().catch(() => {});
  setDb(null);
});

const ev = (summary: string) => ({
  type: "decision" as const,
  at: "2026-09-05T09:00:00.000Z",
  actor: "Emma Taylor",
  summary,
});

describe("appending", () => {
  it("chains from genesis and verifies", async () => {
    await store.append(ORG, ev("first"));
    await store.append(ORG, ev("second"));

    const all = await store.all(ORG);
    expect(all.map((e) => e.seq)).toEqual([0, 1]);
    expect(all[1].prevHash).toBe(all[0].hash);
    expect(await store.verify(ORG)).toEqual({ ok: true, brokenAt: null });
  });

  it("keeps seq numeric, so 10 does not sort before 9", async () => {
    for (let i = 0; i < 11; i++) await store.append(ORG, ev(`e${i}`));
    const all = await store.all(ORG);
    // BIGINT comes back as a string; compared as text this would be wrong
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await store.head(ORG))!.seq).toBe(10);
  });

  it("gives concurrent callers distinct positions, and a chain that holds", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.append(ORG, ev(`c${i}`))));

    const all = await store.all(ORG);
    expect(new Set(all.map((e) => e.seq)).size).toBe(8);
    // the whole point: no two events claiming the same position
    expect(await store.verify(ORG)).toEqual({ ok: true, brokenAt: null });
  });
});

describe("idempotency", () => {
  it("does not append twice for one client ref", async () => {
    const a = await store.append(ORG, ev("dup"), { clientRef: "ref-1" });
    const b = await store.append(ORG, ev("dup"), { clientRef: "ref-1" });

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.event.seq).toBe(a.event.seq);
    expect(await store.all(ORG)).toHaveLength(1);
  });

  it("finds an earlier append by its ref, so a retry is not a duplicate", async () => {
    await store.append(ORG, ev("x"), { clientRef: "ref-2" });
    expect((await store.byClientRef(ORG, "ref-2"))?.summary).toBe("x");
    expect(await store.byClientRef(ORG, "never-used")).toBeNull();
  });
});

describe("what the chain keeps", () => {
  it("stores undefined as absent rather than null, so digests do not change", async () => {
    await store.append(ORG, ev("no did"));
    const e = (await store.all(ORG))[0];
    // canonicalJson drops undefined and keeps null; a null here would re-hash
    // every pre-existing event and read as tampering
    expect("actorDid" in e && e.actorDid === null).toBe(false);
    expect(e.actorDid).toBeUndefined();
    expect(await store.verify(ORG)).toMatchObject({ ok: true });
  });

  it("round-trips data as an object, not a string", async () => {
    await store.append(ORG, { ...ev("with data"), data: { postingId: "sp-1", seats: 2 } });
    const e = (await store.all(ORG))[0];
    expect(e.data).toEqual({ postingId: "sp-1", seats: 2 });
  });

  it("separates orgs, so one venue's chain is not another's", async () => {
    await store.append(ORG, ev("ours"));
    await store.append("org-other", ev("theirs"));

    expect(await store.all(ORG)).toHaveLength(1);
    expect((await store.all("org-other"))[0].seq).toBe(0);
  });
});

describe("recorded_at", () => {
  it("is available beside the event and never inside it", async () => {
    const r = await store.append(ORG, ev("timed"));
    expect(r.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // an extra field on a chained event is indistinguishable from tampering
    expect("recordedAt" in r.event).toBe(false);

    const meta = await store.withMeta(ORG);
    expect(meta[0].recordedAt).toBe(r.recordedAt);
  });
});
