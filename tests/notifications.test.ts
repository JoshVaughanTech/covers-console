import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NotificationStore } from "../lib/store/notifications";
import { EventStore } from "../lib/store/events";
import { audienceFor } from "../lib/notify/audience";
import { offerPosting, isOfferable } from "../lib/notify/offer";
import { credentialsNow, type ShiftPosting } from "../lib/shifts";
import { WORKERS, TODAY, CREDENTIALS } from "../lib/idara/seed";
import type { AuditEvent } from "../lib/idara/types";

/* ============================================================
   Telling people a shift exists.

   A posting nobody hears about fills as slowly as no posting at all,
   which is the gap this closes. The tests are mostly about two
   things going wrong quietly.

   First, that the audience must be exactly who the board would let
   claim. A different answer here is worse than no notification: it
   is an invitation followed by a closed door, and the reason is
   invisible from both sides.

   Second, that offering twice must not stack. A retried append, a
   seat reopening, a script replaying the log — none of them should
   put the same shift on somebody's phone twice or un-read what they
   have already read.
   ============================================================ */

const ORG = "org-test";
const AT = "2026-09-04T09:00:00.000Z";

let events: EventStore;
let notes: NotificationStore;

beforeEach(() => {
  events = new EventStore(":memory:");
  notes = new NotificationStore(":memory:");
});
afterEach(() => {
  events.close();
  notes.close();
});

const posting = (over: Partial<ShiftPosting> = {}): ShiftPosting => ({
  id: "sp-notify",
  role: "Bartender",
  seats: 2,
  functionName: "Friday Live",
  siteId: "s-brightwater",
  day: "Fri, 17 May",
  window: "17:00–01:00",
  shiftId: "Fri",
  duties: ["serve_alcohol"],
  requires: [],
  claims: [],
  assigned: [],
  status: "open",
  ...over,
});

const postedEvent = (p: ShiftPosting): AuditEvent =>
  ({
    seq: 0,
    id: "evt-0",
    type: "shift.posted",
    at: AT,
    actor: "Emma Taylor",
    summary: "posted",
    data: { postingId: p.id, posting: p },
    prevHash: "0".repeat(64),
    hash: "x",
  }) as AuditEvent;

const did = (name: string) => WORKERS.find((w) => w.name === name)!.did;

describe("who hears about a shift", () => {
  it("is exactly who the board would let claim it", () => {
    const p = posting();
    const a = audienceFor({ posting: p, credentials: CREDENTIALS, at: TODAY });

    // Darie holds a current RSA and is inducted at Brightwater
    expect(a.eligible).toContain(did("Darie Roberts"));
    // Michael Tan's RSA is revoked, and this shift serves alcohol
    expect(a.eligible).not.toContain(did("Michael Tan"));
    expect(Object.values(a.blocked).reduce((n, x) => n + x, 0)).toBeGreaterThan(0);
  });

  it("counts the refusals rather than naming who is short of what", () => {
    const a = audienceFor({ posting: posting(), credentials: CREDENTIALS, at: TODAY });
    /* A manager can act on "six would qualify with a current RSA". Naming them
       turns a posting record into a roster of everybody's credential
       problems, and that record is readable by every operator. */
    for (const [reason, count] of Object.entries(a.blocked)) {
      expect(typeof count).toBe("number");
      for (const w of WORKERS) expect(reason).not.toContain(w.name);
    }
  });

  it("does not tell somebody about a shift they are already on", () => {
    const darie = did("Darie Roberts");
    const a = audienceFor({
      posting: posting({ assigned: [darie] }),
      credentials: CREDENTIALS,
      at: TODAY,
    });
    expect(a.eligible).not.toContain(darie);
  });

  it("does not tell somebody about a shift they have already claimed", () => {
    const darie = did("Darie Roberts");
    const a = audienceFor({
      posting: posting({ claims: [{ did: darie, at: TODAY }] }),
      credentials: CREDENTIALS,
      at: TODAY,
    });
    // their hand is already up; telling them again is noise
    expect(a.eligible).not.toContain(darie);
  });

  it("tells them again if their claim was refused and the seat is open", () => {
    const darie = did("Darie Roberts");
    const a = audienceFor({
      posting: posting({ claims: [{ did: darie, at: TODAY, refused: "Not needed" }] }),
      credentials: CREDENTIALS,
      at: TODAY,
    });
    expect(a.eligible).toContain(darie);
  });
});

describe("what gets offered at all", () => {
  it("offers an open posting", () => {
    expect(isOfferable(postedEvent(posting()))).toBe(true);
  });

  it("does not offer a draft", () => {
    // the manager's working copy, offered to nobody
    expect(isOfferable(postedEvent(posting({ status: "draft" })))).toBe(false);
  });

  it("ignores events that are not postings", () => {
    expect(isOfferable({ type: "shift.claimed", data: { postingId: "x" } })).toBe(false);
    expect(isOfferable({ type: "break.decision", data: {} })).toBe(false);
  });
});

describe("offering a posting", () => {
  it("records the offer in the chain and the rows on the phones", () => {
    const p = posting();
    const result = offerPosting(events, notes, ORG, postedEvent(p))!;

    expect(result.told).toBeGreaterThan(0);

    const e = events.all(ORG).find((x) => x.type === "shift.offered")!;
    expect(e.data.postingId).toBe(p.id);
    expect((e.data.audience as string[]).length).toBe(result.told);
    // telling people is the system carrying out somebody else's decision
    expect(e.actor).toBe("system");
    expect(events.verify(ORG).ok).toBe(true);

    const darie = did("Darie Roberts");
    const theirs = notes.forWorker(ORG, darie);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ postingId: p.id, role: "Bartender", seenAt: null });
    // the site NAME, because a phone cannot read s-brightwater
    expect(theirs[0].siteName).toBe("Brightwater Hotel");
  });

  it("says nothing to somebody the board would refuse", () => {
    offerPosting(events, notes, ORG, postedEvent(posting()));
    // an invitation followed by a closed door is worse than silence
    expect(notes.forWorker(ORG, did("Michael Tan"))).toHaveLength(0);
  });

  it("records a shift nobody can take as told to nobody, rather than silently", () => {
    // a gaming shift Darie cannot work; the audience may legitimately be small
    const p = posting({ id: "sp-empty", siteId: "s-brightwater-gaming", duties: ["gaming"] });
    const result = offerPosting(events, notes, ORG, postedEvent(p))!;

    const e = events.all(ORG).find((x) => x.type === "shift.offered")!;
    expect(e.data.postingId).toBe("sp-empty");
    // told: 0 is a finding — it is how a manager learns the shift is unfillable
    expect(Object.keys(e.data.blocked as object).length).toBeGreaterThan(0);
    expect(result.told).toBe((e.data.audience as string[]).length);
  });

  it("returns null for an event that is not an offer", () => {
    expect(offerPosting(events, notes, ORG, postedEvent(posting({ status: "draft" })))).toBeNull();
  });
});

describe("offering twice", () => {
  it("does not put the same shift on a phone twice", () => {
    const p = posting();
    offerPosting(events, notes, ORG, postedEvent(p));
    offerPosting(events, notes, ORG, postedEvent(p));

    expect(notes.forWorker(ORG, did("Darie Roberts"))).toHaveLength(1);
    // and one event, because the clientRef keys it by posting
    expect(events.all(ORG).filter((e) => e.type === "shift.offered")).toHaveLength(1);
  });

  it("leaves a notification that has been read alone", () => {
    const p = posting();
    const darie = did("Darie Roberts");
    offerPosting(events, notes, ORG, postedEvent(p));
    notes.markSeen(ORG, darie, AT);

    offerPosting(events, notes, ORG, postedEvent(p));

    /* Somebody who read about a shift on Tuesday has not un-read it because a
       seat reopened on Thursday. Marking it unread again trains people to
       ignore the badge, which costs more than the one notification. */
    expect(notes.forWorker(ORG, darie)[0].seenAt).toBe(AT);
    expect(notes.unseenCount(ORG, darie)).toBe(0);
  });
});

describe("reading them", () => {
  const darie = () => did("Darie Roberts");

  it("counts what has not been seen", () => {
    offerPosting(events, notes, ORG, postedEvent(posting()));
    offerPosting(events, notes, ORG, postedEvent(posting({ id: "sp-2", functionName: "Saturday" })));
    expect(notes.unseenCount(ORG, darie())).toBe(2);
  });

  it("marks one without marking the rest", () => {
    offerPosting(events, notes, ORG, postedEvent(posting()));
    offerPosting(events, notes, ORG, postedEvent(posting({ id: "sp-2", functionName: "Saturday" })));

    expect(notes.markSeen(ORG, darie(), AT, ["sp-notify"])).toBe(1);
    expect(notes.unseenCount(ORG, darie())).toBe(1);
  });

  it("marks everything when asked for everything", () => {
    offerPosting(events, notes, ORG, postedEvent(posting()));
    offerPosting(events, notes, ORG, postedEvent(posting({ id: "sp-2", functionName: "Saturday" })));

    expect(notes.markSeen(ORG, darie(), AT)).toBe(2);
    expect(notes.unseenCount(ORG, darie())).toBe(0);
  });

  it("never touches anybody else's", () => {
    offerPosting(events, notes, ORG, postedEvent(posting()));
    const other = WORKERS.find((w) => w.did !== darie() && notes.forWorker(ORG, w.did).length > 0)!;
    expect(other).toBeTruthy();

    notes.markSeen(ORG, darie(), AT);
    // clearing somebody else's badge would hide a shift from them, and the
    // badge is the only thing that would have said so
    expect(notes.unseenCount(ORG, other.did)).toBe(1);
  });

  it("marking an empty list marks nothing, rather than everything", () => {
    offerPosting(events, notes, ORG, postedEvent(posting()));
    // the difference between "these" and "all" must not turn on an empty array
    expect(notes.markSeen(ORG, darie(), AT, [])).toBe(0);
    expect(notes.unseenCount(ORG, darie())).toBe(1);
  });
});

describe("the audience follows the chain, not the seed", () => {
  it("stops offering to somebody whose credential was revoked", () => {
    const darie = did("Darie Roberts");
    const rsa = CREDENTIALS.find((c) => c.subject === darie && c.type === "rsa")!;

    events.append(ORG, {
      type: "credential.revoked",
      at: TODAY,
      actor: "Emma Taylor",
      subject: darie,
      summary: "RSA revoked",
      data: { credId: rsa.id, type: "rsa" },
    });

    const a = audienceFor({
      posting: posting(),
      credentials: credentialsNow(events.all(ORG)),
      at: TODAY,
    });
    // the console revoked it; the notification must not still be going out
    expect(a.eligible).not.toContain(darie);
  });
});
