import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ============================================================
   POST /api/reports/weekly/run, through the real handler.

   This endpoint writes files, and the app is sometimes bound to
   0.0.0.0 so a phone on the venue Wi-Fi can reach the mobile
   screen. Open, it would let anyone on that network write into
   the payroll directory — so the auth path is the part worth
   pinning, not the happy one.
   ============================================================ */

/* No database to point at any more: with no DATABASE_URL the store opens an
   in-process Postgres, and vitest gives each test FILE its own worker, so
   these routes get a database nobody else is writing to. Cases within one
   file do share it — the ones that care set their own org or clientRef. */
process.env.COVERS_ORG = "org-test";
process.env.REPORTS_RUN_TOKEN = "correct-horse-battery-staple";

const dir = mkdtempSync(join(tmpdir(), "covers-run-api-"));
process.env.REPORTS_DIR = dir;

let route: typeof import("../app/api/reports/weekly/run/route");
beforeAll(async () => {
  route = await import("../app/api/reports/weekly/run/route");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const post = (token?: string, qs = "") =>
  new Request(`http://x/api/reports/weekly/run${qs}`, {
    method: "POST",
    headers: token ? { "x-run-token": token } : {},
  });

describe("authentication", () => {
  it("is invisible without a token", async () => {
    const res = await route.POST(post());
    // 404 rather than 401: an unauthenticated caller should not learn that
    // this endpoint exists, nor that a token was merely wrong
    expect(res.status).toBe(404);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("is invisible with the wrong token", async () => {
    expect((await route.POST(post("nope"))).status).toBe(404);
    // a prefix of the real token must not read as closer than any other guess
    expect((await route.POST(post("correct-horse"))).status).toBe(404);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("refuses everyone when no token is configured", async () => {
    const saved = process.env.REPORTS_RUN_TOKEN;
    delete process.env.REPORTS_RUN_TOKEN;
    // an unset token must lock the door, not remove it
    expect((await route.POST(post(""))).status).toBe(404);
    expect((await route.POST(post("anything"))).status).toBe(404);
    process.env.REPORTS_RUN_TOKEN = saved;
  });
});

describe("a dry run", () => {
  it("reports what would be delivered without writing it", async () => {
    const res = await route.POST(post(process.env.REPORTS_RUN_TOKEN, "?dryRun=1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.filename).toMatch(/^break-loading_.*\.csv$/);
    expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(readdirSync(dir)).toHaveLength(0);
  });
});

describe("nowhere to deliver to", () => {
  it("says so rather than failing silently", async () => {
    const saved = process.env.REPORTS_DIR;
    delete process.env.REPORTS_DIR;
    const res = await route.POST(post(process.env.REPORTS_RUN_TOKEN));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/REPORTS_DIR/);
    process.env.REPORTS_DIR = saved;
  });
});
