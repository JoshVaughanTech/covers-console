import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NotificationStore } from "../lib/store/notifications";
import { EventStore } from "../lib/store/events";
import { audienceFor } from "../lib/notify/audience";
import { offerPosting, isOfferable } from "../lib/notify/offer";
import { credentialsNow, type ShiftPosting } from "../lib/shifts";
import { WORKERS, TODAY, CREDENTIALS } from "../lib/idara/seed";
import type { AuditEvent } from "../lib/idara/types";
import { db, setDb } from "../lib/store/db";

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

beforeEach(async () => {
  setDb(null);
  /* One database, two stores — which is what production is. Under SQLite
     each ":memory:" was a database of its own, so these two never shared
     one until now. */
  const d = await db();
  events = new EventStore(d);
  notes = new NotificationStore(d);
});
afterEach(async () => {
  await events.close();   // one database; closing it twice would be the same close
  setDb(null);
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
  it("is exactly who the board would let claim it", async () => {
    const p = posting();
    const a = audienceFor({ posting: p, credentials: CREDENTIALS, at: TODAY });

    // Darie holds a current RSA and is inducted at Brightwater
    expect(a.eligible).toContain(did("Darie Roberts"));
    // Michael Tan's RSA is revoked, and this shift serves alcohol
    expect(a.eligible).not.toContain(did("Michael Tan"));
    expect(Object.values(a.blocked).reduce((n, x) => n + x, 0)).toBeGreaterThan(0);
  });

  it("counts the refusals rather than naming who is short of what", async () => {
    const a = audienceFor({ posting: posting(), credentials: CREDENTIALS, at: TODAY });
    /* A manager can act on "six would qualify with a current RSA". Naming them
       turns a posting record into a roster of everybody's credential
       problems, and that record is readable by every operator. */
    for (const [reason, count] of Object.entries(a.blocked)) {
      expect(typeof count).toBe("number");
      for (const w of WORKERS) expect(reason).not.toContain(w.name);
    }
  });

  it("does not tell somebody about a shift they are already on", async () => {
    const darie = did("Darie Roberts");
    const a = audienceFor({
      posting: posting({ assigned: [darie] }),
      credentials: CREDENTIALS,
      at: TODAY,
    });
    expect(a.eligible).not.toContain(darie);
  });

  it("does not tell somebody about a shift they have already claimed", async () => {
    const darie = did("Darie Roberts");
    const a = audienceFor({
      posting: posting({ claims: [{ did: darie, at: TODAY }] }),
      credentials: CREDENTIALS,
      at: TODAY,
    });
    // their hand is already up; telling them again is noise
    expect(a.eligible).not.toContain(darie);
  });

  it("tells them again if their claim was refused and the seat is open", async () => {
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
  it("offers an open posting", async () => {
    expect(isOfferable(postedEvent(posting()))).toBe(true);
  });

  it("does not offer a draft", async () => {
    // the manager's working copy, offered to nobody
    expect(isOfferable(postedEvent(posting({ status: "draft" })))).toBe(false);
  });

  it("ignores events that are not postings", async () => {
    expect(isOfferable({ type: "shift.claimed", data: { postingId: "x" } })).toBe(false);
    expect(isOfferable({ type: "break.decision", data: {} })).toBe(false);
  });
});

describe("offering a posting", () => {
  it("records the offer in the chain and the rows on the phones", async () => {
    const p = posting();
    const result = (await offerPosting(events, notes, ORG, postedEvent(p)))!;

    expect(result.told).toBeGreaterThan(0);

    const e = (await events.all(ORG)).find((x) => x.type === "shift.offered")!;
    expect(e.data.postingId).toBe(p.id);
    expect((e.data.audience as string[]).length).toBe(result.told);
    // telling people is the system carrying out somebody else's decision
    expect(e.actor).toBe("system");
    expect((await events.verify(ORG)).ok).toBe(true);

    const darie = did("Darie Roberts");
    const theirs = await notes.forWorker(ORG, darie);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ postingId: p.id, role: "Bartender", seenAt: null });
    // the site NAME, because a phone cannot read s-brightwater
    expect(theirs[0].siteName).toBe("Brightwater Hotel");
  });

  it("says nothing to somebody the board would refuse", async () => {
    await offerPosting(events, notes, ORG, postedEvent(posting()));
    // an invitation followed by a closed door is worse than silence
    expect(await notes.forWorker(ORG, did("Michael Tan"))).toHaveLength(0);
  });

  it("records a shift nobody can take as told to nobody, rather than silently", async () => {
    // a gaming shift Darie cannot work; the audience may legitimately be small
    const p = posting({ id: "sp-empty", siteId: "s-brightwater-gaming", duties: ["gaming"] });
    const result = (await offerPosting(events, notes, ORG, postedEvent(p)))!;

    const e = (await events.all(ORG)).find((x) => x.type === "shift.offered")!;
    expect(e.data.postingId).toBe("sp-empty");
    // told: 0 is a finding — it is how a manager learns the shift is unfillable
    expect(Object.keys(e.data.blocked as object).length).toBeGreaterThan(0);
    expect(result.told).toBe((e.data.audience as string[]).length);
  });

  it("returns null for an event that is not an offer", async () => {
    expect(await offerPosting(events, notes, ORG, postedEvent(posting({ status: "draft" })))).toBeNull();
  });
});

describe("offering twice", () => {
  it("does not put the same shift on a phone twice", async () => {
    const p = posting();
    await offerPosting(events, notes, ORG, postedEvent(p));
    await offerPosting(events, notes, ORG, postedEvent(p));

    expect(await notes.forWorker(ORG, did("Darie Roberts"))).toHaveLength(1);
    // and one event, because the clientRef keys it by posting
    expect((await events.all(ORG)).filter((e) => e.type === "shift.offered")).toHaveLength(1);
  });

  it("leaves a notification that has been read alone", async () => {
    const p = posting();
    const darie = did("Darie Roberts");
    await offerPosting(events, notes, ORG, postedEvent(p));
    await notes.markSeen(ORG, darie, AT);

    await offerPosting(events, notes, ORG, postedEvent(p));

    /* Somebody who read about a shift on Tuesday has not un-read it because a
       seat reopened on Thursday. Marking it unread again trains people to
       ignore the badge, which costs more than the one notification. */
    expect((await notes.forWorker(ORG, darie))[0].seenAt).toBe(AT);
    expect(await notes.unseenCount(ORG, darie)).toBe(0);
  });
});

describe("reading them", () => {
  const darie = () => did("Darie Roberts");

  it("counts what has not been seen", async () => {
    await offerPosting(events, notes, ORG, postedEvent(posting()));
    await offerPosting(events, notes, ORG, postedEvent(posting({ id: "sp-2", functionName: "Saturday" })));
    expect(await notes.unseenCount(ORG, darie())).toBe(2);
  });

  it("marks one without marking the rest", async () => {
    await offerPosting(events, notes, ORG, postedEvent(posting()));
    await offerPosting(events, notes, ORG, postedEvent(posting({ id: "sp-2", functionName: "Saturday" })));

    expect(await notes.markSeen(ORG, darie(), AT, ["sp-notify"])).toBe(1);
    expect(await notes.unseenCount(ORG, darie())).toBe(1);
  });

  it("marks everything when asked for everything", async () => {
    await offerPosting(events, notes, ORG, postedEvent(posting()));
    await offerPosting(events, notes, ORG, postedEvent(posting({ id: "sp-2", functionName: "Saturday" })));

    expect(await notes.markSeen(ORG, darie(), AT)).toBe(2);
    expect(await notes.unseenCount(ORG, darie())).toBe(0);
  });

  it("never touches anybody else's", async () => {
    await offerPosting(events, notes, ORG, postedEvent(posting()));
    let other!: (typeof WORKERS)[number];
    for (const w of WORKERS) {
      if (w.did !== darie() && (await notes.forWorker(ORG, w.did)).length > 0) { other = w; break; }
    }
    expect(other).toBeTruthy();

    await notes.markSeen(ORG, darie(), AT);
    // clearing somebody else's badge would hide a shift from them, and the
    // badge is the only thing that would have said so
    expect(await notes.unseenCount(ORG, other.did)).toBe(1);
  });

  it("marking an empty list marks nothing, rather than everything", async () => {
    await offerPosting(events, notes, ORG, postedEvent(posting()));
    // the difference between "these" and "all" must not turn on an empty array
    expect(await notes.markSeen(ORG, darie(), AT, [])).toBe(0);
    expect(await notes.unseenCount(ORG, darie())).toBe(1);
  });
});

describe("the audience follows the chain, not the seed", () => {
  it("stops offering to somebody whose credential was revoked", async () => {
    const darie = did("Darie Roberts");
    const rsa = CREDENTIALS.find((c) => c.subject === darie && c.type === "rsa")!;

    await events.append(ORG, {
      type: "credential.revoked",
      at: TODAY,
      actor: "Emma Taylor",
      subject: darie,
      summary: "RSA revoked",
      data: { credId: rsa.id, type: "rsa" },
    });

    const a = audienceFor({
      posting: posting(),
      credentials: credentialsNow((await events.all(ORG))),
      at: TODAY,
    });
    // the console revoked it; the notification must not still be going out
    expect(a.eligible).not.toContain(darie);
  });
});
