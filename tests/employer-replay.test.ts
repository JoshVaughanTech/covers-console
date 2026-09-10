/* ============================================================
   The venue's record is the seed plus what it decided since.

   POST /api/employer used to mutate EMPLOYERS[0] in place and
   write nothing. The switch it mutated is one-tap employment: off,
   a worker who has completed a pack cannot be employed here. There
   was no record of who turned it off, it was lost on restart, and
   on a serverless deployment two instances disagreed about it.

   The seed-immutability case is the one that guards the original
   bug directly. The rest pin the fold.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { replayEmployer } from "../lib/idara/employer-replay";
import { EMPLOYERS } from "../lib/idara/employer-seed";
import type { AuditEvent } from "../lib/idara/types";

let seq = 0;
const ev = (type: string, data: Record<string, unknown>): AuditEvent =>
  ({
    seq: ++seq,
    type,
    at: "2026-09-10T02:00:00.000Z",
    actor: "Emma Taylor",
    summary: "",
    data,
    hash: "",
    prevHash: "",
  }) as unknown as AuditEvent;

/** A copy, so a case that folds cannot affect the next one through the seed. */
const seed = () => structuredClone(EMPLOYERS[0]);

describe("folding the employer profile", () => {
  it("is the seed when nothing has happened", () => {
    expect(replayEmployer(seed(), [])).toEqual(seed());
  });

  it("turns one-tap employment off", () => {
    const p = replayEmployer(seed(), [ev("employer.packs_set", { accepts: false })]);
    expect(p.acceptsPacks).toBe(false);
  });

  it("applies settings in seq order, so the last decision stands", () => {
    const p = replayEmployer(seed(), [
      ev("employer.packs_set", { accepts: false }),
      ev("employer.packs_set", { accepts: true }),
    ]);
    expect(p.acceptsPacks).toBe(true);
  });

  it("orders by seq even when the log arrives shuffled", () => {
    const first = ev("employer.packs_set", { accepts: true });
    const second = ev("employer.packs_set", { accepts: false });
    expect(replayEmployer(seed(), [second, first]).acceptsPacks).toBe(false);
  });

  it("disconnects the payroll, which is what makes a venue unable to employ", () => {
    const p = replayEmployer(seed(), [ev("employer.payroll_disconnected", {})]);
    expect(p.payroll).toBeUndefined();
  });

  it("connects one back, with what the event said", () => {
    const p = replayEmployer(seed(), [
      ev("employer.payroll_disconnected", {}),
      ev("employer.payroll_connected", { connector: "mock", tenantRef: "other-tenant", connectedAt: "2026-09-10" }),
    ]);
    expect(p.payroll).toEqual({ connector: "mock", tenantRef: "other-tenant", connectedAt: "2026-09-10" });
  });

  it("leaves everything it was not told about alone", () => {
    const p = replayEmployer(seed(), [ev("employer.packs_set", { accepts: false })]);
    const s = seed();
    expect(p.abn).toBe(s.abn);
    expect(p.workersComp).toEqual(s.workersComp);
    expect(p.classifications).toEqual(s.classifications);
    expect(p.signatoryDid).toBe(s.signatoryDid);
  });
});

describe("what the fold refuses to invent", () => {
  it("ignores events that are not the employer's", () => {
    const p = replayEmployer(seed(), [
      ev("roster.published", { siteId: "s-brightwater" }),
      ev("engagement.accepted", { accepts: false }),
      ev("task.moved", { taskId: "t1" }),
    ]);
    expect(p).toEqual(seed());
  });

  it("skips a packs_set carrying no boolean rather than coercing one", () => {
    /* Both directions, and the falsy one is the case that bites. The seed
       accepts packs, so a truthy non-boolean coerces to the value it already
       had and proves nothing — that version of this test passed against a fold
       that had replaced the type check with Boolean(). A falsy one is the only
       input on which skipping and coercing differ. */
    expect(seed().acceptsPacks).toBe(true);

    for (const accepts of ["", 0, null]) {
      const p = replayEmployer(seed(), [ev("employer.packs_set", { accepts })]);
      expect(p.acceptsPacks, `${JSON.stringify(accepts)} is not false`).toBe(true);
    }

    // and the other way, so this does not become a test that only rejects
    for (const accepts of ["false", 1, {}]) {
      const p = replayEmployer(seed(), [ev("employer.packs_set", { accepts })]);
      expect(p.acceptsPacks).toBe(true);
    }
  });

  it("skips a connection it cannot describe, leaving the previous one standing", () => {
    const p = replayEmployer(seed(), [ev("employer.payroll_connected", { connector: "mock" })]);
    expect(p.payroll).toEqual(seed().payroll);
  });
});

describe("the seed is never written to", () => {
  it("survives a fold that changes everything", () => {
    /* THE case. The bug this replaces was `delete p.payroll` on the module
       object: the next reader in the same process saw a venue that had never
       connected a payroll, and a restart put it back. */
    const before = structuredClone(EMPLOYERS[0]);

    replayEmployer(EMPLOYERS[0], [
      ev("employer.packs_set", { accepts: false }),
      ev("employer.payroll_disconnected", {}),
    ]);

    expect(EMPLOYERS[0]).toEqual(before);
  });

  it("does not hand back the seed's own payroll object to be edited", () => {
    // a shallow copy would share it, so a later mutation would reach the seed
    const p = replayEmployer(EMPLOYERS[0], []);
    expect(p.payroll).not.toBe(EMPLOYERS[0].payroll);
  });

  it("gives the same answer folded twice", () => {
    const log = [ev("employer.packs_set", { accepts: false })];
    expect(replayEmployer(EMPLOYERS[0], log)).toEqual(replayEmployer(EMPLOYERS[0], log));
  });
});
