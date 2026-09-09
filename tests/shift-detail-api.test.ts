import { describe, it, expect, beforeAll } from "vitest";
import { WORKERS } from "../lib/idara/seed";
import { signIn, asCaller, type TestSession } from "./sign-in-helper";

/* ============================================================
   One shift at its own address.

   The test this file exists for is the agreement one. A shift is
   now on two screens — the board lists it, /m/shifts/[id] renders
   it alone — and the whole reason lib/shifts/view.ts exists is that
   they must be describing the same shift. This repo has shipped
   that divergence twice: a queue showing one person twice while the
   worker saw one claim, and a card reading the real start time
   beside a sheet reading the day string a manager typed.

   Neither was caught by a test. Both were caught by looking. So
   this asserts it per shift and per worker rather than trusting
   that one function is called from two places today.

   The other half is what a URL can be used for. A list you are
   handed cannot be probed; an id in a path can, so a draft has to
   answer the same way a shift that never existed does.
   ============================================================ */

process.env.COVERS_ORG = "org-test-detail";

let board: typeof import("../app/api/shifts/route");
let detail: typeof import("../app/api/shifts/[id]/route");

beforeAll(async () => {
  board = await import("../app/api/shifts/route");
  detail = await import("../app/api/shifts/[id]/route");
});

const did = (name: string) => WORKERS.find((w) => w.name === name)!.did;

const sessions = new Map<string, TestSession>();
const as = async (name: string): Promise<TestSession> => {
  const key = did(name);
  if (!sessions.has(key)) sessions.set(key, await signIn(key));
  return sessions.get(key)!;
};

const listFor = async (who: string) => {
  const res = await board.GET(asCaller(await as(who), "http://x/api/shifts"));
  return (await res.json()) as { shifts: { id: string }[] };
};

const oneFor = async (who: string, id: string) => {
  const res = await detail.GET(
    asCaller(await as(who), `http://x/api/shifts/${id}`),
    { params: Promise.resolve({ id }) },
  );
  return { res, body: await res.json() };
};

const DRAFT = "sp-quayside-wait";

describe("the board and the detail describe one shift", () => {
  /* Two workers rather than one. The mapping takes the caller's credentials,
     so a bug that dropped `did` on the way through would still agree with
     itself for whoever happened to be first. */
  for (const who of ["Darie Roberts", "Michael Tan"]) {
    it(`agrees field for field, for every shift ${who} can see`, async () => {
      const list = await listFor(who);
      expect(list.shifts.length).toBeGreaterThan(0);

      for (const listed of list.shifts) {
        const { res, body } = await oneFor(who, listed.id);
        expect(res.status, listed.id).toBe(200);
        // deep equality, not a spot check on the fields that happen to matter
        // today: the point is that neither screen can be told something the
        // other was not
        expect(body.shift, listed.id).toEqual(listed);
      }
    });
  }

  it("answers the cookie, not the URL", async () => {
    /* The guard that the id in the path does not decide whose shift this is.
       One posting, three people, three different true answers — measured
       rather than assumed, because a test that only asserted "they differ"
       would pass on an empty seed and prove nothing.

       If the caller were ever read from the path, all three would be
       identical and every other test in this file would still be green. */
    const id = "sp-2038-wait";

    const darie = await oneFor("Darie Roberts", id);
    const michael = await oneFor("Michael Tan", id);
    const priya = await oneFor("Priya Sharma", id);

    expect(darie.body.shift.blockReason).toBe("Induction for Docklands Corporate Lunch not held.");
    // a revoked credential, which is a different refusal from a missing one
    expect(michael.body.shift.blockReason).toBe("RSA: Credential has been revoked.");
    // eligible, and already in the queue — so still not claimable, for the
    // opposite reason to the other two
    expect(priya.body.shift.blockReason).toBeNull();
    expect(priya.body.shift.standing?.standing).toBe("open");

    for (const [who, r] of [["Darie Roberts", darie], ["Michael Tan", michael], ["Priya Sharma", priya]] as const) {
      expect(r.body.worker.name, who).toBe(who);
      expect(r.body.shift.id, who).toBe(id);
      expect(r.body.shift.claimable, who).toBe(false);
    }
  });
});

describe("what it refuses", () => {
  it("401s without a session", async () => {
    const res = await detail.GET(
      new Request("http://x/api/shifts/sp-2041-bar"),
      { params: Promise.resolve({ id: "sp-2041-bar" }) },
    );
    expect(res.status).toBe(401);
  });

  it("404s an id that does not exist", async () => {
    const { res } = await oneFor("Darie Roberts", "sp-not-a-shift");
    expect(res.status).toBe(404);
  });

  it("404s a draft, identically to a shift that never existed", async () => {
    /* A draft is the venue's unpublished working copy. Answering 403 for it
       and 404 for nonsense would turn a URL into a way to enumerate drafts —
       and the seeded draft is the one sitting UNDER the award floor, so the
       rate a venue is still arguing about would be one guessed id away from
       the worker it would underpay. */
    const draft = await oneFor("Darie Roberts", DRAFT);
    const nothing = await oneFor("Darie Roberts", "sp-not-a-shift");

    expect(draft.res.status).toBe(404);
    expect(draft.body).toEqual(nothing.body);
  });

  it("keeps the draft off the board too", async () => {
    // the same posting, from the other route: one rule, both places
    const list = await listFor("Darie Roberts");
    expect(list.shifts.map((s) => s.id)).not.toContain(DRAFT);
  });
});

describe("what it carries", () => {
  it("names the worker it answered for", async () => {
    const list = await listFor("Darie Roberts");
    const { body } = await oneFor("Darie Roberts", list.shifts[0].id);
    expect(body.worker.did).toBe(did("Darie Roberts"));
    expect(body.worker.name).toBe("Darie Roberts");
  });

  it("carries the pay panel's own numbers, not a summary of them", async () => {
    /* The detail screen renders the award bands. If the detail route ever
       returned a thinner shift than the board, the panel would silently draw
       fewer rows than the total was built from. */
    const list = await listFor("Darie Roberts");
    const paid = (list.shifts as { id: string; pay: unknown }[]).find((s) => s.pay);
    if (!paid) throw new Error("seed has no priced shift");

    const { body } = await oneFor("Darie Roberts", paid.id);
    expect(body.shift.pay).toEqual(paid.pay);
    expect(Array.isArray(body.shift.pay.bands)).toBe(true);
    expect(body.shift.pay.bands.length).toBeGreaterThan(0);
  });
});
