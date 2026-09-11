/* ============================================================
   A local database that will not open stops the database, not
   the app.

   #46 gave `npm run dev` a persistent PGlite directory so a task
   moved on the run sheet survived a restart. What it did not
   survive was an ABRUPT stop — a closed terminal, an ended
   session, a machine that slept. Postgres removes postmaster.pid
   on a clean shutdown and leaves it on a kill, and PGlite then
   answers PGlite.create(dir) with `RuntimeError: Aborted()`.

   That threw out of freshDb(), so db() rejected, so every route
   touching the store answered 500 — sign-in included. The console
   was unusable until somebody read a WASM stack trace and knew it
   meant "delete .data/pg". Which is a worse failure than the one
   persistence replaced: before it, a restart lost the board; after
   it, a kill lost the board AND the app.

   Two properties, and the second is the one that matters more.
   The app carries on. And it does not carry on QUIETLY — the
   board silently ceasing to survive restarts is the failure
   `.data/pg` exists to prevent, arriving by a quieter door.
   ============================================================ */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { openPglite, storageDegraded, clearStorageDegraded } from "../lib/store/db";

const DIR = ".data/test-unopenable";

beforeEach(() => {
  clearStorageDegraded();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  clearStorageDegraded();
  vi.restoreAllMocks();
  rmSync(DIR, { recursive: true, force: true });
});

/** A real directory PGlite refuses: present, and not a database. */
function unopenable(): string {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/PG_VERSION`, "18\n");
  return DIR;
}

/** Stands in for the module, so the policy can be tested without the WASM. */
const throwing = (e: unknown) => ({
  create: (dir?: string) => (dir === undefined ? Promise.resolve("memory") : Promise.reject(e)),
});
const working = { create: (dir?: string) => Promise.resolve(dir ?? "memory") };

describe("when the directory opens", () => {
  it("uses it, and reports nothing wrong", async () => {
    expect(await openPglite(working, ".data/somewhere")).toBe(".data/somewhere");
    expect(storageDegraded()).toBeNull();
  });

  it("asks for memory when there is no directory to use", async () => {
    // tests and a production process both take this path; it is not a failure
    expect(await openPglite(working, undefined)).toBe("memory");
    expect(storageDegraded()).toBeNull();
  });
});

describe("when the directory will not open", () => {
  it("carries on in memory rather than taking the app down with it", async () => {
    const db = await openPglite(throwing(new Error("Aborted()")), ".data/pg");
    expect(db).toBe("memory");
  });

  it("says which directory, and what it threw", async () => {
    /* The operator of this failure has a stack trace already and cannot act on
       it. What they need is the path. */
    await openPglite(throwing(new Error("Aborted()")), ".data/pg");
    expect(storageDegraded()).toEqual({ dir: ".data/pg", cause: "Error: Aborted()" });
  });

  it("leaves a flag as well as a log line", async () => {
    /* A log line scrolls away, and a silent fall back to memory means the
       board stops surviving restarts with nothing saying so — the failure
       .data/pg was added to fix, returning by a quieter door. */
    await openPglite(throwing(new Error("Aborted()")), ".data/pg");
    expect(storageDegraded()).not.toBeNull();
    expect(console.error).toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain(".data/pg");
  });

  it("catches whatever it throws, not a message it recognises", async () => {
    /* The real corruption threw RuntimeError: Aborted(); a malformed directory
       throws "PGlite failed to initialize properly"; a third cause would throw
       a third thing. Matching on any of them would be a guard that works until
       the next kind of broken. */
    for (const thrown of [
      new Error("PGlite failed to initialize properly"),
      Object.assign(new Error("Aborted()"), { name: "RuntimeError" }),
      "a string, because not everything throws an Error",
      { code: "ENOSPC" },
    ]) {
      clearStorageDegraded();
      expect(await openPglite(throwing(thrown), ".data/pg")).toBe("memory");
      expect(storageDegraded()?.dir).toBe(".data/pg");
    }
  });

  it("does not delete or move the directory", async () => {
    /* It is somebody's, they may want to look at it, and the catch is broad
       enough to fire on a transient failure — quarantining a working directory
       on one of those would throw away the persistence this protects. */
    const dir = unopenable();
    await openPglite(throwing(new Error("Aborted()")), dir);
    expect(() => writeFileSync(`${dir}/still-here`, "yes")).not.toThrow();
  });
});

describe("against PGlite itself", () => {
  it("falls back on a directory PGlite really will not open", async () => {
    /* The cases above stand in for the module so the policy can be tested
       without the WASM. This one is the whole thing: a real directory, the
       real PGlite, a real refusal. */
    const { PGlite } = await import("@electric-sql/pglite");
    const db = (await openPglite(PGlite, unopenable())) as { query: (s: string) => Promise<unknown>; close: () => Promise<void> };

    // and what comes back is a working database, not a broken handle
    await expect(db.query("select 1 as ok")).resolves.toBeTruthy();
    await db.close();

    expect(storageDegraded()?.dir).toBe(DIR);
  }, 30_000);
});
