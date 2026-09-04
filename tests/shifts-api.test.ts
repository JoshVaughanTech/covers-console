import { describe, it, expect, beforeAll } from "vitest";
import { WORKERS, TODAY } from "../lib/idara/seed";
import { signIn, asCaller, type TestSession } from "./sign-in-helper";

/* ============================================================
   The marketplace's other side, through the real route handlers.

   The thing these exist to hold: a phone is a different process on
   a network the venue does not control, so nothing it sends is
   evidence. The board comes from the chain, eligibility is
   recomputed, and the claim is re-checked. A request that asks for
   a shift the worker cannot work must be refused even though the
   app would never have rendered the button.

   And the round trip, which is the one that would break silently:
   a claim must land as an event the board can be rebuilt from. A
   claim living anywhere else exists in storage and not on the
   board, and the screen looks broken when the event is what is
   missing.
   ============================================================ */

process.env.COVERS_DB = ":memory:";
process.env.COVERS_ORG = "org-test";

let shifts: typeof import("../app/api/shifts/route");
let claim: typeof import("../app/api/shifts/claim/route");
let withdraw: typeof import("../app/api/shifts/withdraw/route");
let store: typeof import("../lib/store/events");

beforeAll(async () => {
  shifts = await import("../app/api/shifts/route");
  claim = await import("../app/api/shifts/claim/route");
  withdraw = await import("../app/api/shifts/withdraw/route");
  store = await import("../lib/store/events");
});

const did = (name: string) => WORKERS.find((w) => w.name === name)!.did;

/* One session per worker, minted through the real grant-and-redeem path.
   The routes take identity from the cookie now, so a test that skipped this
   would be testing the 401. */
const sessions = new Map<string, TestSession>();
const as = (name: string): TestSession => {
  const key = did(name);
  if (!sessions.has(key)) sessions.set(key, signIn(key));
  return sessions.get(key)!;
};

const board = async (who: string) => {
  const res = await shifts.GET(asCaller(as(who), "http://x/api/shifts"));
  return { res, body: await res.json() };
};

const putHandUp = async (who: string, postingId: string, clientRef?: string) => {
  const res = await claim.POST(
    asCaller(as(who), "http://x/api/shifts/claim", {
      method: "POST",
      body: JSON.stringify({ postingId, clientRef }),
    }),
  );
  return { res, body: await res.json() };
};

const takeHandDown = async (who: string, postingId: string, clientRef?: string) => {
  const res = await withdraw.POST(
    asCaller(as(who), "http://x/api/shifts/withdraw", {
      method: "POST",
      body: JSON.stringify({ postingId, clientRef }),
    }),
  );
  return { res, body: await res.json() };
};

/* Postings from the seed, chosen for what they prove:
   sp-2041-bar   — in-house-ish wedding bar, two seats, nobody on it
   sp-quayside-wait — a draft, never offered to anyone */
/**
 * Somebody who can actually take this posting today.
 *
 * Answered from the domain rather than by calling the route once per worker:
 * that version crossed the 5s test timeout under load and failed as though
 * the idempotency were broken, which is a worse failure than a slow one.
 */
const findClaimant = async (postingId: string): Promise<string> => {
  const { boardFrom, claimBlockReason, seatsLeft } = await import("../lib/shifts");
  const { LocalCredentialVerifier } = await import("../lib/idara/verifier");
  const { SITES } = await import("../lib/idara/seed");

  const b = boardFrom(store.eventStore().all("org-test"));
  const p = b.postings.find((x) => x.id === postingId);
  if (!p) throw new Error(`no posting ${postingId}`);
  const verifier = new LocalCredentialVerifier();

  for (const w of WORKERS) {
    if (p.assigned.includes(w.did)) continue;
    if (p.claims.some((c) => c.did === w.did && !c.refused)) continue;
    if (seatsLeft(p) === 0) break;
    const blocked = claimBlockReason({
      posting: p,
      person: w,
      site: SITES.find((s) => s.id === p.siteId),
      credentials: b.credentials.filter((c) => c.subject === w.did),
      at: b.at,
      verifier,
    });
    if (!blocked) return w.name;
  }
  throw new Error(`no worker in the seed can claim ${postingId}`);
};

const BAR = "sp-2041-bar";
const DRAFT = "sp-quayside-wait";

describe("the board one worker sees", () => {
  it("names who it is for and what date it was answered against", async () => {
    const { res, body } = await board("Darie Roberts");
    expect(res.status).toBe(200);
    expect(body.worker.name).toBe("Darie Roberts");
    // the demo world is dated; a gate on the wall clock would refuse everyone
    expect(body.at).toBe(TODAY);
  });

  it("never offers a draft, which has not been offered to anyone", async () => {
    const { body } = await board("Darie Roberts");
    expect(body.shifts.some((s: { id: string }) => s.id === DRAFT)).toBe(false);
  });

  it("shows blocked shifts with the reason rather than hiding them", async () => {
    const { body } = await board("Michael Tan");
    const blocked = body.shifts.filter((s: { blockReason: string | null }) => s.blockReason);
    expect(blocked.length).toBeGreaterThan(0);
    // "RSA expired" is something a casual can act on; a missing row is not
    for (const s of blocked) {
      expect(s.blockReason).toBeTruthy();
      expect(s.claimable).toBe(false);
    }
  });

  it("does not offer a shift the worker is already rostered on", async () => {
    /* Found by opening the app, not by a test. Darie is ASSIGNED to the Friday
       Live bar in the seed and never claimed it — and standingFor() answers
       about claims, so his standing was null and the board called the shift
       claimable. The server refused it as a duplicate, which is the gate
       working; the screen offering it was the bug. */
    const { body } = await board("Darie Roberts");
    const s = body.shifts.find((x: { id: string }) => x.id === "sp-fridaylive-bar");
    expect(s.rostered).toBe(true);
    expect(s.claimable).toBe(false);
  });

  it("shows nobody a board without a session", async () => {
    // the did used to be a query parameter, so any phone could ask for
    // anybody’s board; there is nothing left to put in a URL
    expect((await shifts.GET(new Request("http://x/api/shifts"))).status).toBe(401);
    expect(
      (await shifts.GET(new Request("http://x/api/shifts?did=did:web:idara.app:w:darie-roberts")))
        .status,
    ).toBe(401);
  });
});

describe("putting a hand up", () => {
  it("records the claim and puts it on the board", async () => {
    const before = await board("Darie Roberts");
    const target = before.body.shifts.find((s: { id: string }) => s.id === BAR);
    expect(target.claimable).toBe(true);
    expect(target.standing).toBeNull();

    const { res, body } = await putHandUp("Darie Roberts", BAR);
    expect(res.status).toBe(201);
    expect(body.claimed).toBe(true);

    // the round trip: the board is rebuilt from the chain, so if the event
    // were the wrong shape the claim would simply not be there
    const after = await board("Darie Roberts");
    const now = after.body.shifts.find((s: { id: string }) => s.id === BAR);
    expect(now.standing.standing).toBe("open");
    expect(now.claimable).toBe(false);
  });

  it("writes an event the manager's queue can read", async () => {
    const events = store.eventStore().all("org-test").filter((e) => e.type === "shift.claimed");
    expect(events.length).toBeGreaterThan(0);

    const e = events[events.length - 1];
    // replayPostings() folds on exactly these two; without them the claim
    // exists in the log and not on the board
    expect(e.data.postingId).toBe(BAR);
    expect(e.subject).toBe(did("Darie Roberts"));
    // and the chain still holds
    expect(store.eventStore().verify("org-test").ok).toBe(true);
  });

  it("carries the claimant's identity, not just their display name", async () => {
    const e = store
      .eventStore()
      .all("org-test")
      .filter((x) => x.type === "shift.claimed")
      .at(-1)!;
    expect(e.actor).toBe("Darie Roberts");
    // two people called Sam Taylor are indistinguishable by name alone
    expect(e.actorDid).toBe(did("Darie Roberts"));
    expect(e.data.via).toBe("mobile");
  });

  it("refuses a second claim on the same shift", async () => {
    const { res, body } = await putHandUp("Darie Roberts", BAR);
    expect(res.status).toBe(409);
    expect(body.kind).toBe("duplicate");
  });

  it("treats a retry with the same client ref as one claim", async () => {
    const countBefore = store.eventStore().all("org-test").filter((e) => e.type === "shift.claimed").length;

    /* Ask the board who is eligible rather than naming someone and hoping.
       A hard-coded name here would fail the day the seed changed, and it
       would fail as though the idempotency were broken. */
    const eligible = await findClaimant(BAR);
    const ref = `claim:${did(eligible)}:${BAR}`;
    const first = await putHandUp(eligible, BAR, ref);
    const retry = await putHandUp(eligible, BAR, ref);

    expect(first.res.status).toBe(201);
    // a phone on venue Wi-Fi retries; the queue must not gain a second request
    expect(retry.res.status).toBe(200);
    expect(retry.body.created).toBe(false);

    const countAfter = store.eventStore().all("org-test").filter((e) => e.type === "shift.claimed").length;
    expect(countAfter).toBe(countBefore + 1);
  });
});

describe("what the phone cannot talk its way past", () => {
  it("refuses a claim the worker is not eligible for, button or no button", async () => {
    // Michael Tan's RSA is revoked; the app would never show him this control
    const { res, body } = await putHandUp("Michael Tan", BAR);
    expect(res.status).toBe(409);
    expect(body.kind).toBe("blocked");
    expect(body.error).toMatch(/RSA|Induction/i);
  });

  it("refuses a claim against a draft", async () => {
    const { res } = await putHandUp("Darie Roberts", DRAFT);
    expect(res.status).toBe(409);
  });

  it("refuses an unknown posting", async () => {
    expect((await putHandUp("Darie Roberts", "sp-nope")).res.status).toBe(404);
  });

  it("refuses a claim with no session at all", async () => {
    /* There is no longer a way to claim as someone else, because there is no
       longer a way to say who you are: the body carries a posting and
       nothing more. */
    const res = await claim.POST(
      new Request("http://x/api/shifts/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ did: "did:web:idara.app:w:darie-roberts", postingId: BAR }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body rather than guessing", async () => {
    const bad = await claim.POST(
      asCaller(as("Darie Roberts"), "http://x/api/shifts/claim", { method: "POST", body: "not json" }),
    );
    expect(bad.status).toBe(400);

    const missing = await claim.POST(
      asCaller(as("Darie Roberts"), "http://x/api/shifts/claim", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(missing.status).toBe(400);
  });
});

describe("taking a hand back down", () => {
  /* The claim route has had this coverage since it was written; the withdraw
     route is newer and had none, which is the only reason this block exists.
     It is the same round trip in reverse: an event that the fold cannot read
     leaves the claim on the board, and the screen looks broken when the event
     is what is wrong. */
  it("removes the claim and takes it off the board", async () => {
    const who = await findClaimant(BAR);
    const put = await putHandUp(who, BAR);
    expect(put.res.status).toBe(201);

    const claimed = await board(who);
    expect(claimed.body.shifts.find((x: { id: string }) => x.id === BAR).standing.standing).toBe("open");

    const { res, body } = await takeHandDown(who, BAR);
    expect(res.status).toBe(200);
    expect(body.withdrawn).toBe(true);

    // rebuilt from the chain: if the event were the wrong shape the claim
    // would still be standing here
    const after = await board(who);
    const now = after.body.shifts.find((x: { id: string }) => x.id === BAR);
    expect(now.standing).toBeNull();
  });

  it("lets them put their hand up again", async () => {
    // the whole argument for making this easy: a claim you cannot take back
    // is one people hesitate to make
    const who = await findClaimant(BAR);
    expect((await putHandUp(who, BAR)).res.status).toBe(201);
    expect((await takeHandDown(who, BAR)).res.status).toBe(200);
    expect((await putHandUp(who, BAR)).res.status).toBe(201);
    await takeHandDown(who, BAR);
  });

  it("writes an event the board can be rebuilt from, and keeps the chain", async () => {
    const events = store.eventStore().all("org-test").filter((e) => e.type === "shift.withdrawn");
    expect(events.length).toBeGreaterThan(0);

    const e = events[events.length - 1];
    // replayPostings() folds on exactly these two
    expect(e.data.postingId).toBe(BAR);
    expect(e.subject).toMatch(/^did:web:idara\.app:/);
    expect(e.actorDid).toBe(e.subject);

    /* The chain check this route did not have. canonicalJson() hashes null and
       drops undefined, so an optional field sent as null re-hashes every prior
       event as tampered — a payload mistake here breaks the whole log, not
       just this row. */
    expect(store.eventStore().verify("org-test").ok).toBe(true);
  });

  it("refuses when there is no claim to withdraw", async () => {
    const { res, body } = await takeHandDown("Darie Roberts", DRAFT);
    expect(res.status).toBe(409);
    expect(body.kind).toBe("none");
  });

  it("refuses an unknown posting", async () => {
    expect((await takeHandDown("Darie Roberts", "sp-nope")).res.status).toBe(404);
  });

  it("refuses with no session at all", async () => {
    // the did is not in the body and cannot be put there
    const res = await withdraw.POST(
      new Request("http://x/api/shifts/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ did: "did:web:idara.app:w:darie-roberts", postingId: BAR }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body rather than guessing", async () => {
    const bad = await withdraw.POST(
      asCaller(as("Darie Roberts"), "http://x/api/shifts/withdraw", { method: "POST", body: "not json" }),
    );
    expect(bad.status).toBe(400);
    const missing = await withdraw.POST(
      asCaller(as("Darie Roberts"), "http://x/api/shifts/withdraw", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(missing.status).toBe(400);
  });

  it("treats a retry with the same client ref as one withdrawal", async () => {
    const who = await findClaimant(BAR);
    await putHandUp(who, BAR);

    const before = store.eventStore().all("org-test").filter((e) => e.type === "shift.withdrawn").length;
    const ref = `withdraw:${did(who)}:${BAR}`;
    const first = await takeHandDown(who, BAR, ref);
    const retry = await takeHandDown(who, BAR, ref);

    expect(first.res.status).toBe(200);
    /* Without the ref this retry is a 409 "no claim to withdraw" — a failure
       reported for a write that succeeded, which is the exact shape the claim
       route's idempotency exists to avoid. */
    expect(retry.res.status).toBe(200);
    expect(retry.body.created).toBe(false);

    const after = store.eventStore().all("org-test").filter((e) => e.type === "shift.withdrawn").length;
    expect(after).toBe(before + 1);
  });
});
