import { describe, it, expect, afterEach } from "vitest";
import { db, setDb, lockKey, withChainLock } from "../lib/store/db";

/* ============================================================
   The seam itself, before anything is built on it.

   Worth its own tests because everything else assumes these
   behave: a transaction that does not roll back would leave the
   chain half-written, and a lock key that is not stable would stop
   serialising the thing it exists to serialise — silently, with the
   chain forking only under load.
   ============================================================ */

afterEach(async () => {
  const d = await db();
  await d.close().catch(() => {});
  setDb(null);
});

describe("the lock key", () => {
  it("is stable for the same string", () => {
    expect(lockKey("org-brightwater")).toBe(lockKey("org-brightwater"));
  });

  it("differs between orgs, so one venue does not block another", () => {
    expect(lockKey("org-a")).not.toBe(lockKey("org-b"));
  });

  it("fits a signed 64-bit integer, which is what pg accepts", () => {
    for (const s of ["", "org-brightwater", "x".repeat(200), "üñïçødé"]) {
      const k = lockKey(s);
      expect(k).toBeGreaterThanOrEqual(-(2n ** 63n));
      expect(k).toBeLessThan(2n ** 63n);
    }
  });
});

describe("the database", () => {
  it("is real Postgres, not an approximation of it", async () => {
    const d = await db();
    const { rows } = await d.query<{ v: string }>("SELECT version() AS v");
    // if this ever says SQLite the seam has been wired to the wrong thing
    expect(rows[0].v).toMatch(/PostgreSQL/);
  });

  it("speaks Postgres placeholders and types", async () => {
    const d = await db();
    const { rows } = await d.query<{ n: number; t: string }>(
      "SELECT $1::int AS n, $2::text AS t",
      [7, "hello"],
    );
    expect(rows[0].n).toBe(7);
    expect(rows[0].t).toBe("hello");
  });

  it("takes the advisory lock the chain depends on", async () => {
    const d = await db();
    const seen = await d.transaction((tx) => withChainLock(tx, "org-test", async () => "held"));
    expect(seen).toBe("held");
  });
});

describe("transactions", () => {
  it("commits what succeeded", async () => {
    const d = await db();
    await d.query("CREATE TABLE t (id int)");
    await d.transaction(async (tx) => {
      await tx.query("INSERT INTO t VALUES (1)");
    });
    expect((await d.query("SELECT * FROM t")).rows).toHaveLength(1);
  });

  it("rolls back what threw, rather than leaving half of it", async () => {
    const d = await db();
    await d.query("CREATE TABLE t (id int)");

    await expect(
      d.transaction(async (tx) => {
        await tx.query("INSERT INTO t VALUES (1)");
        // the chain's append does several writes; a partial one is a fork
        throw new Error("something went wrong halfway");
      }),
    ).rejects.toThrow(/halfway/);

    expect((await d.query("SELECT * FROM t")).rows).toHaveLength(0);
  });

  it("reports how many rows a write touched", async () => {
    const d = await db();
    await d.query("CREATE TABLE t (id int)");
    await d.query("INSERT INTO t VALUES (1), (2), (3)");
    // stores decide idempotency on this: 0 means somebody else got there first
    expect((await d.query("DELETE FROM t WHERE id > 1")).rowCount).toBe(2);
  });
});
