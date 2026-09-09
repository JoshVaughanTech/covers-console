import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EventStore } from "../lib/store/events";
import { freshDb, withChainLock, type Db } from "../lib/store/db";

/* ============================================================
   The driver that actually ships.

   Every other test in this repo runs against PGlite, which is real
   Postgres and is not the real code path: `db()` builds a PgliteDb
   when DATABASE_URL is absent and a PgDb when it is present, and
   those are two different implementations of transaction(). So the
   class that runs in production had never been executed by a test —
   the suite could be green against an implementation nothing
   deploys.

   The gap that mattered most is concurrency. PGlite is one
   connection, so tests/event-store-pg.test.ts says plainly that it
   demonstrates distinct positions and a chain that verifies, and
   NOT that a real server serialises two connections. That rested on
   pg_advisory_xact_lock being correct, reasoned rather than
   observed. This file observes it.

   Skipped unless DATABASE_URL is set, so it costs nothing on a
   laptop and runs against the deployment's own database when there
   is one. Scoped to its own org id and cleaned up after: chains are
   per-org, so writing and removing one leaves every other chain
   exactly as it was.
   ============================================================ */

const URL = process.env.DATABASE_URL;
const ORG = `org-pgtest-${Math.random().toString(36).slice(2, 10)}`;

/* The concurrency case needs a chain with nothing in it, because it asserts
   the positions are exactly 0..N-1. Every other case here shares ORG on
   purpose — the BIGINT case reads back what the transaction case wrote — so
   the one that needs to start empty gets its own org rather than the others
   giving up their sequence. Without this it counts the transaction case's
   single event as a thirteenth append and fails on a property the driver
   holds perfectly well. */
const ORG_CONCURRENT = `${ORG}-concurrent`;

let database: Db;

const ev = (summary: string) => ({
  type: "decision" as const,
  at: "2026-09-09T09:00:00.000Z",
  actor: "Emma Taylor",
  summary,
});

describe.skipIf(!URL)("the pg driver, against a real server", () => {
  beforeAll(async () => {
    database = await freshDb();
  });

  afterAll(async () => {
    // leave the database as it was found: this org's rows and nobody else's
    for (const org of [ORG, ORG_CONCURRENT]) {
      await database.query("DELETE FROM audit_event WHERE org_id = $1", [org]).catch(() => {});
      await database.query("DELETE FROM chain_head WHERE org_id = $1", [org]).catch(() => {});
    }
    await database.close().catch(() => {});
  });

  it("is a PgDb, not the PGlite one every other test gets", () => {
    expect(database.constructor.name).toBe("PgDb");
  });

  describe("transactions", () => {
    it("commits every statement or none, across one connection", async () => {
      const store = new EventStore(database);
      await store.append(ORG, ev("first"));

      /* A failure partway through must leave nothing. The pool is the hazard
         this is really testing: if BEGIN and COMMIT reached different
         connections, the rollback would apply to a session that did no work
         and the half-written row would survive. */
      await expect(
        database.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO audit_event
               (org_id, seq, id, type, at, recorded_at, actor, summary, data, prev_hash, hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [ORG, 99, "evt-doomed", "decision", "2026-09-09T09:00:00.000Z",
             new Date().toISOString(), "Emma Taylor", "doomed", {}, "0".repeat(64), "x".repeat(64)],
          );
          throw new Error("deliberate");
        }),
      ).rejects.toThrow("deliberate");

      const rows = await store.all(ORG);
      expect(rows).toHaveLength(1);
      expect(rows.map((e) => e.id)).not.toContain("evt-doomed");
    });
  });

  describe("the advisory lock, doing the job PGlite cannot show it doing", () => {
    it("serialises appends arriving on different connections", async () => {
      /* The test the design exists for, and the one that could not be written
         until there was a server with more than one connection. Concurrent
         appends each read the tail to derive seq and prevHash, so without the
         lock two of them read the same tail and mint two events claiming one
         position — a forked chain that still looks like a chain. */
      const store = new EventStore(database);
      const N = 12;
      await Promise.all(Array.from({ length: N }, (_, i) => store.append(ORG_CONCURRENT, ev(`c${i}`))));

      const all = await store.all(ORG_CONCURRENT);
      expect(all).toHaveLength(N);

      // gapless and in order: exactly 0..N-1, no position claimed twice
      expect(all.map((e) => e.seq)).toEqual(Array.from({ length: N }, (_, i) => i));
      expect(new Set(all.map((e) => e.hash)).size).toBe(N);

      expect(await store.verify(ORG_CONCURRENT)).toEqual({ ok: true, brokenAt: null });
    });

    it("is held for the transaction, not the connection", async () => {
      /* pg_advisory_xact_lock releases at COMMIT. A session-scoped lock would
         outlive the work and be returned to the pool still held, so the next
         caller to borrow that connection would hold a lock it never took —
         and the one after would wait forever on it. */
      const order: string[] = [];
      const key = `${ORG}:lock`;

      const worker = (name: string) =>
        database.transaction(async (tx) =>
          withChainLock(tx, key, async () => {
            order.push(`${name}:in`);
            await new Promise((r) => setTimeout(r, 60));
            order.push(`${name}:out`);
          }),
        );

      await Promise.all([worker("a"), worker("b")]);

      // whoever went first finished before the other started
      expect(order).toHaveLength(4);
      expect(order[1]).toBe(order[0].replace(":in", ":out"));
      expect(order[3]).toBe(order[2].replace(":in", ":out"));
    });
  });

  describe("what the driver returns", () => {
    it("gives seq back as a number, however the driver types BIGINT", async () => {
      /* node-postgres returns BIGINT as a string to avoid losing precision
         above 2^53; PGlite may not. A seq that arrives as "10" sorts before
         "9" and compares unequal to 10, so the mapping has to hold on the
         driver that ships, not only on the one under test. */
      const store = new EventStore(database);
      const head = await store.head(ORG);
      expect(typeof head!.seq).toBe("number");

      const all = await store.all(ORG);
      for (const e of all) expect(typeof e.seq).toBe("number");
    });
  });
});
