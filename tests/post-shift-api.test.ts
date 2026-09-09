import { describe, it, expect, beforeAll } from "vitest";
import { WORKERS } from "../lib/idara/seed";
import { OPERATORS } from "../lib/auth/operators";
import { signIn, signInOperator, asCaller, type TestSession } from "./sign-in-helper";

/* ============================================================
   Publishing a shift, through the route that decides.

   The check this file exists for is the award floor, and it exists
   because for a while there was nothing holding it. buildPosting()
   ran in the console's browser and /api/events took the resulting
   event without re-asking, so the refusal that makes "Covers will
   not publish below the award" true was reachable only by people
   using the form.

   That was not a worry, it was reproduced: with a Venue Manager
   session, a Friday 17:00–01:00 casual Level 2 shift offering
   $30.00/h posted successfully and reached a worker's board as
   claimable, against a $40.62/h Saturday floor.

   So the cases below are the two halves of one promise. The gate
   refuses from a request as well as from a form; and the old way
   in is closed, because a gate with a door beside it is a door.
   ============================================================ */

process.env.COVERS_ORG = "org-test-post";

let post: typeof import("../app/api/shifts/post/route");
let board: typeof import("../app/api/shifts/route");
let events: typeof import("../app/api/events/route");

beforeAll(async () => {
  post = await import("../app/api/shifts/post/route");
  board = await import("../app/api/shifts/route");
  events = await import("../app/api/events/route");
});

const workerDid = (name: string) => WORKERS.find((w) => w.name === name)!.did;
const opDid = (name: string) => OPERATORS.find((o) => o.name === name)!.did;

let venue: TestSession;
let staff: TestSession;
beforeAll(async () => {
  venue = await signInOperator(opDid("Sophie Nguyen"));
  staff = await signIn(workerDid("Darie Roberts"));
});

/** A Friday 17:00–01:00 casual Level 2 bar shift — it crosses into Saturday. */
const shift = (over: Record<string, unknown> = {}) => ({
  role: "Bartender",
  seats: "1",
  functionName: "Friday Live",
  siteId: "s-brightwater",
  duties: ["serve_alcohol"],
  publish: true,
  date: "2026-07-17",
  startTime: "17:00",
  endTime: "01:00",
  day: "Fri, 17 Jul",
  window: "17:00–01:00",
  level: "2",
  employment: "casual",
  rate: "44.00",
  unpaidBreakMin: "30",
  ...over,
});

const send = async (session: TestSession | null, body: unknown) => {
  const req = session
    ? asCaller(session, "http://x/api/shifts/post", { method: "POST", body: JSON.stringify(body) })
    : new Request("http://x/api/shifts/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
  const res = await post.POST(req);
  return { res, body: await res.json() };
};

describe("the award floor, from a request rather than a form", () => {
  it("refuses a rate below the floor, and says by how much", async () => {
    const { res, body } = await send(venue, shift({ rate: "30.00", clientRef: "under-1" }));
    expect(res.status).toBe(422);
    expect(body.errors.join(" ")).toContain("$40.62/h");
    expect(body.errors.join(" ")).toContain("below the MA000009 floor");
  });

  it("refuses on the DEAREST hour, not the average", async () => {
    /* The whole reason priceShift() returns segments. This shift is 7 weekday
       evening hours at $36.80 and one Saturday hour at $40.62; $37.00 clears
       the blend and underpays the midnight hour. A gate that compared means
       would let this through, and the one hour it underpays is real money. */
    const { res, body } = await send(venue, shift({ rate: "37.00", clientRef: "avg-1" }));
    expect(res.status).toBe(422);
    expect(body.errors.join(" ")).toContain("$40.62/h");
  });

  it("publishes when the rate clears every hour", async () => {
    const { res, body } = await send(venue, shift({ clientRef: "ok-1" }));
    expect(res.status).toBe(201);
    expect(body.posted).toBe(true);
    expect(body.posting.pay.offeredHourlyCents).toBe(4400);
    expect(body.posting.status).toBe("open");
  });

  it("checks a draft too, because a draft is published later", async () => {
    // saved today, put on the board next week — telling them then is too late
    const { res, body } = await send(venue, shift({ rate: "30.00", publish: false, clientRef: "draft-1" }));
    expect(res.status).toBe(422);
    expect(body.errors.join(" ")).toContain("$40.62/h");
  });

  it("puts what it published on the board a worker reads", async () => {
    /* An event the board cannot be rebuilt from is a posting that exists in
       storage and not on the board — the screen looks broken and the missing
       thing is the fold. */
    const { body: made } = await send(venue, shift({ functionName: "Reaches the board", clientRef: "board-1" }));
    const res = await board.GET(asCaller(staff, "http://x/api/shifts"));
    const seen = ((await res.json()).shifts as { id: string; pay: { atOrAboveFloor: boolean } }[])
      .find((s) => s.id === made.posting.id);
    expect(seen, "the posting did not reach the board").toBeDefined();
    expect(seen!.pay.atOrAboveFloor).toBe(true);
  });
});

describe("who may post", () => {
  it("401s with no session", async () => {
    const { res } = await send(null, shift());
    expect(res.status).toBe(401);
  });

  it("401s a worker — claiming and offering are different powers", async () => {
    /* Sophie Nguyen exists in both rosters. Which sign-in was used decides
       what the session may do, and nothing here reads the did to guess. */
    const { res } = await send(staff, shift({ clientRef: "worker-1" }));
    expect(res.status).toBe(401);
  });
});

describe("what it will not take from the caller", () => {
  it("mints the id itself rather than accepting one", async () => {
    /* replayPostings() folds by id, so a caller-supplied id colliding with a
       seeded posting would not add a shift — it would overwrite one that may
       already have claims against it. */
    const { body } = await send(venue, shift({ id: "sp-2041-bar", clientRef: "id-1" }));
    expect(body.posting.id).not.toBe("sp-2041-bar");
    expect(body.posting.id).toMatch(/^sp-[0-9a-f]{8}$/);
  });

  it("does not publish twice when a phone retries", async () => {
    const first = await send(venue, shift({ functionName: "Retry", clientRef: "retry-1" }));
    const again = await send(venue, shift({ functionName: "Retry", clientRef: "retry-1" }));
    expect(first.body.created).toBe(true);
    expect(again.body.created).toBe(false);
    expect(again.body.posting.id).toBe(first.body.posting.id);
  });

  it("answers 422 rather than 500 on a body of the wrong shape", async () => {
    // the sender is a phone on a network the venue does not control
    const { res } = await send(venue, { role: 7, seats: [], duties: "not-an-array", rate: {} });
    expect(res.status).toBe(422);
  });

  it("takes the actor from the session, not the body", async () => {
    const { body } = await send(venue, shift({ actor: "Somebody Else", functionName: "Actor", clientRef: "actor-1" }));
    expect(body.posted).toBe(true);
    // the posting is recorded against the session that made it
    const res = await board.GET(asCaller(staff, "http://x/api/shifts"));
    expect(((await res.json()).shifts as { id: string }[]).some((s) => s.id === body.posting.id)).toBe(true);
  });
});

describe("the way round it is shut", () => {
  it("refuses a shift.posted written straight to the event log", async () => {
    /* This is the hole the route was built to close. An operator could append
       the event directly and the award check never ran. */
    const res = await events.POST(
      asCaller(venue, "http://x/api/events", {
        method: "POST",
        body: JSON.stringify({
          type: "shift.posted",
          at: "2026-09-09",
          summary: "straight to the log",
          data: { postingId: "sp-bypass", posting: { id: "sp-bypass", role: "Bartender" } },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("/api/shifts/post");
  });

  it("still takes the other event types", async () => {
    // the guard is one type, not a general refusal
    const res = await events.POST(
      asCaller(venue, "http://x/api/events", {
        method: "POST",
        body: JSON.stringify({ type: "decision", at: "2026-09-09", summary: "an ordinary event" }),
      }),
    );
    expect(res.status).toBe(201);
  });
});
