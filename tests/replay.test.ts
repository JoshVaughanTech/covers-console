/* ============================================================
   Rebuilding the board from the trail.

   The property that matters: replaying the log gives back exactly
   the board the log describes. Before this, the audit chain was
   durable and the marketplace was not, so after a reload /audit
   still said someone had claimed a shift — chain verifying — while
   the queue showed no such claim. The state and its own record
   disagreed, which for a compliance product is the worst available
   inconsistency.

   The cure is not a second store beside the chain; two stores of
   one fact can drift. It is that the board IS the fold, so they
   cannot disagree by construction. These tests pin that.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { replayPostings, isShiftEvent } from "../lib/shifts/replay";
import { POSTINGS } from "../lib/shifts/seed";
import { appendEvent } from "../lib/idara/audit";
import { WORKERS } from "../lib/idara/seed";
import type { AuditEvent, NewAuditEvent } from "../lib/idara";
import type { ShiftPosting } from "../lib/shifts/types";

const AT = "2024-05-16";
const did = (name: string) => {
  const w = WORKERS.find((x) => x.name === name);
  if (!w) throw new Error(`no worker ${name}`);
  return w.did;
};

/** Build a chain the way the app does, so hashes and order are real. */
const chain = (...events: NewAuditEvent[]): AuditEvent[] =>
  events.reduce<AuditEvent[]>((log, e) => appendEvent(log, e), []);

const claimed = (postingId: string, subject: string, at = AT): NewAuditEvent => ({
  type: "shift.claimed",
  at,
  actor: "someone",
  subject,
  summary: "claimed",
  data: { postingId },
});

const assigned = (postingId: string, subject: string): NewAuditEvent => ({
  type: "shift.assigned",
  at: AT,
  actor: "Emma Taylor",
  subject,
  summary: "assigned",
  data: { postingId },
});

const declined = (postingId: string, subject: string, reason: string): NewAuditEvent => ({
  type: "decision",
  at: AT,
  actor: "Emma Taylor",
  subject,
  summary: "declined",
  data: { postingId, outcome: "declined", reason },
});

const posted = (p: ShiftPosting): NewAuditEvent => ({
  type: "shift.posted",
  at: AT,
  actor: "Emma Taylor",
  summary: "posted",
  data: { postingId: p.id, posting: p },
});

const newPosting = (id: string): ShiftPosting => ({
  id,
  role: "Bartender",
  seats: 2,
  functionName: "Late Session",
  siteId: "s-brightwater",
  day: "Tue, 21 May",
  window: "18:00–23:00",
  shiftId: "Tue",
  duties: ["serve_alcohol"],
  requires: [],
  claims: [],
  assigned: [],
  status: "open",
});

const find = (ps: ShiftPosting[], id: string) => {
  const p = ps.find((x) => x.id === id);
  if (!p) throw new Error(`no posting ${id}`);
  return p;
};

describe("an empty log", () => {
  it("gives back the seed unchanged", async () => {
    expect(replayPostings(POSTINGS, [])).toEqual(POSTINGS);
  });
});

describe("replaying what happened", () => {
  it("restores a claim", async () => {
    const log = chain(claimed("sp-2041-bar", did("Darie Roberts")));
    const p = find(replayPostings(POSTINGS, log), "sp-2041-bar");
    expect(p.claims.some((c) => c.did === did("Darie Roberts"))).toBe(true);
  });

  it("restores an assignment and the seat it fills", async () => {
    const log = chain(assigned("sp-2041-bar", did("Darie Roberts")));
    const p = find(replayPostings(POSTINGS, log), "sp-2041-bar");
    expect(p.assigned).toContain(did("Darie Roberts"));
    expect(p.status).toBe("open"); // 1 of 2 seats
  });

  it("marks a posting filled once its seats are taken", async () => {
    const log = chain(
      assigned("sp-2041-bar", did("Darie Roberts")),
      assigned("sp-2041-bar", did("Mitch Egan")),
    );
    expect(find(replayPostings(POSTINGS, log), "sp-2041-bar").status).toBe("filled");
  });

  it("restores a decline with the reason the manager gave", async () => {
    const log = chain(declined("sp-2041-wait", did("Mitch Egan"), "Needed at Brightwater"));
    const p = find(replayPostings(POSTINGS, log), "sp-2041-wait");
    expect(p.claims.find((c) => c.did === did("Mitch Egan"))?.refused).toBe("Needed at Brightwater");
  });

  it("restores a posting that did not exist in the seed", async () => {
    const log = chain(posted(newPosting("sp-new-1")));
    const ps = replayPostings(POSTINGS, log);
    expect(ps).toHaveLength(POSTINGS.length + 1);
    expect(find(ps, "sp-new-1").functionName).toBe("Late Session");
  });

  it("replays a claim on a posting that itself came from the log", async () => {
    // the ordering that matters: the posting must exist before the claim lands
    const log = chain(posted(newPosting("sp-new-2")), claimed("sp-new-2", did("Aaron Patel")));
    expect(find(replayPostings(POSTINGS, log), "sp-new-2").claims).toHaveLength(1);
  });
});

describe("replaying is lossless and repeatable", () => {
  const log = () =>
    chain(
      posted(newPosting("sp-new-3")),
      claimed("sp-new-3", did("Aaron Patel")),
      assigned("sp-2041-bar", did("Darie Roberts")),
      declined("sp-2041-wait", did("Mitch Egan"), "Needed elsewhere"),
    );

  it("gives the same board every time — a reload is not a dice roll", async () => {
    expect(replayPostings(POSTINGS, log())).toEqual(replayPostings(POSTINGS, log()));
  });

  it("does not mutate the seed it folds over", async () => {
    const before = structuredClone(POSTINGS);
    replayPostings(POSTINGS, log());
    expect(POSTINGS).toEqual(before);
  });

  it("is idempotent per event — a replayed claim is not a second claim", async () => {
    // the same event applied twice must not double the claim, or a reconnect
    // that re-reads the log would inflate the queue
    const l = chain(claimed("sp-2041-bar", did("Darie Roberts")));
    const twice = [...l, ...l];
    expect(find(replayPostings(POSTINGS, twice), "sp-2041-bar").claims).toHaveLength(1);
  });

  it("does not assign the same person twice", async () => {
    const l = chain(assigned("sp-2041-bar", did("Darie Roberts")));
    expect(find(replayPostings(POSTINGS, [...l, ...l]), "sp-2041-bar").assigned).toHaveLength(1);
  });

  it("does not add a posted shift twice", async () => {
    const l = chain(posted(newPosting("sp-new-4")));
    expect(replayPostings(POSTINGS, [...l, ...l])).toHaveLength(POSTINGS.length + 1);
  });
});

describe("which events belong to the board", () => {
  it("claims that a shift event is ours", async () => {
    const [e] = chain(claimed("sp-2041-bar", did("Darie Roberts")));
    expect(isShiftEvent(e)).toBe(true);
  });

  it("recognises a decline by its shape, since it writes as a plain decision", async () => {
    const [e] = chain(declined("sp-2041-wait", did("Mitch Egan"), "no"));
    expect(isShiftEvent(e)).toBe(true);
  });

  it("ignores an unrelated decision", async () => {
    // a break decision or a roster publish carries no posting id
    const [e] = chain({
      type: "decision",
      at: AT,
      actor: "Emma Taylor",
      subject: did("Darie Roberts"),
      summary: "break given",
      data: { award: "HIGA" },
    });
    expect(isShiftEvent(e)).toBe(false);
  });

  it("ignores a credential revocation", async () => {
    const [e] = chain({
      type: "credential.revoked",
      at: AT,
      actor: "Emma Taylor",
      summary: "revoked",
      data: {},
    });
    expect(isShiftEvent(e)).toBe(false);
  });

  it("leaves the board untouched when the log holds nothing of ours", async () => {
    const log = chain({
      type: "roster.published",
      at: AT,
      actor: "Emma Taylor",
      summary: "published",
      data: {},
    });
    expect(replayPostings(POSTINGS, log)).toEqual(POSTINGS);
  });
});

describe("events that cannot be applied", () => {
  it("skips a posted event carrying no posting, rather than failing the board", async () => {
    const log = chain({
      type: "shift.posted",
      at: AT,
      actor: "Emma Taylor",
      summary: "posted",
      data: { postingId: "sp-broken" },
    });
    expect(replayPostings(POSTINGS, log)).toEqual(POSTINGS);
  });

  it("ignores an event naming a posting that does not exist", async () => {
    const log = chain(claimed("sp-does-not-exist", did("Darie Roberts")));
    expect(replayPostings(POSTINGS, log)).toEqual(POSTINGS);
  });

  it("ignores a claim with no subject", async () => {
    const log = chain({
      type: "shift.claimed",
      at: AT,
      actor: "someone",
      summary: "claimed",
      data: { postingId: "sp-2041-bar" },
    });
    expect(replayPostings(POSTINGS, log)).toEqual(POSTINGS);
  });
});
