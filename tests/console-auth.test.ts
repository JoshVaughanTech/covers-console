import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPERATORS } from "../lib/auth/operators";
import { WORKERS } from "../lib/idara/seed";
import { COOKIE } from "../lib/auth/cookie";

/* ============================================================
   Console sign-in.

   The tests that matter here are the crossings. A worker's phone
   session must not open the console, and an operator's session must
   not be a worker — not because anyone would write that on purpose,
   but because the kind was added to a schema that already worked,
   and a field added correctly and then not consulted looks identical
   to correct code.

   The second theme is that an operator credential is not a worker
   credential with more permissions. It mints everybody else's, so
   the channel carrying it has to prove something, and the only one
   here that proves anything is a file on the server.
   ============================================================ */

process.env.COVERS_DB = ":memory:";
process.env.COVERS_ORG = "org-test";

let request: typeof import("../app/api/auth/console/request/route");
let redeem: typeof import("../app/api/auth/console/redeem/route");
let session: typeof import("../app/api/auth/session/route");
let issue: typeof import("../app/api/auth/issue/route");
let workerRequest: typeof import("../app/api/auth/request/route");
let workerRedeem: typeof import("../app/api/auth/redeem/route");
let shifts: typeof import("../app/api/shifts/route");
let store: typeof import("../lib/store/events");

let codesDir: string;

beforeAll(async () => {
  codesDir = mkdtempSync(join(tmpdir(), "covers-console-auth-"));
  process.env.AUTH_CODES_DIR = codesDir;

  request = await import("../app/api/auth/console/request/route");
  redeem = await import("../app/api/auth/console/redeem/route");
  session = await import("../app/api/auth/session/route");
  issue = await import("../app/api/auth/issue/route");
  workerRequest = await import("../app/api/auth/request/route");
  workerRedeem = await import("../app/api/auth/redeem/route");
  shifts = await import("../app/api/shifts/route");
  store = await import("../lib/store/events");
});

afterEach(() => vi.unstubAllEnvs());

let n = 0;
const anOperator = () => OPERATORS[n++ % OPERATORS.length];
const aWorker = () => WORKERS[n++ % WORKERS.length];

const json = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const cookieFrom = (res: Response): string | null => {
  const set = res.headers.get("set-cookie");
  if (!set) return null;
  const v = set.split(";")[0];
  return v.startsWith(`${COOKIE}=`) && v.length > COOKIE.length + 1 ? v : null;
};

/** The code the server wrote to its file — the only place it exists. */
const codeFromFile = (name: string): string => {
  const log = readFileSync(join(codesDir, "sign-in-codes.log"), "utf8");
  const line = log.split("\n").filter((l) => l.includes(name)).at(-1);
  if (!line) throw new Error(`no code written for ${name}`);
  return line.match(/code ([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})/)![1];
};

/** Sign an operator in the way a person would: file, then code. */
const signInOperator = async (did: string, name: string): Promise<string> => {
  const asked = await request.POST(json("http://x/api/auth/console/request", { did }));
  expect(asked.status).toBe(200);
  const res = await redeem.POST(
    json("http://x/api/auth/console/redeem", { did, code: codeFromFile(name) }),
  );
  expect(res.status).toBe(200);
  return cookieFrom(res)!;
};

describe("asking for a console code", () => {
  it("never returns it, and writes it where only the server can read", async () => {
    const op = anOperator();
    const { status } = await request.POST(json("http://x/api/auth/console/request", { did: op.did }));
    expect(status).toBe(200);

    const body = await (await request.POST(json("http://x/api/auth/console/request", { did: op.did }))).json();
    // an operator credential mints everybody else's; there is no environment
    // and no variable that makes returning it acceptable
    expect(body.code).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
    expect(codeFromFile(op.name)).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("answers a worker's did exactly as it answers an operator's", async () => {
    const w = aWorker();
    const res = await request.POST(json("http://x/api/auth/console/request", { did: w.did }));
    // confirming a name is on the console roster is worth more to an attacker
    // than confirming somebody works here
    expect(res.status).toBe(200);
    expect((await res.json()).sent).toBe(true);
  });

  it("refuses entirely when no file channel is configured", async () => {
    vi.stubEnv("AUTH_CODES_DIR", "");
    const res = await request.POST(json("http://x/api/auth/console/request", { did: anOperator().did }));
    // a console nobody can sign into is a smaller problem than one anyone can
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toMatch(/AUTH_CODES_DIR/);
  });
});

describe("the crossings", () => {
  it("will not let a worker's code open the console", async () => {
    const w = aWorker();
    const asked = await workerRequest.POST(json("http://x/api/auth/request", { did: w.did }));
    expect(asked.status).toBe(200);

    const res = await redeem.POST(
      json("http://x/api/auth/console/redeem", { did: w.did, code: codeFromFile(w.name) }),
    );
    // the kind is on the grant, so this is refused by a fact rather than by
    // this route remembering to ask
    expect(res.status).toBe(401);
    expect(cookieFrom(res)).toBeNull();
  });

  it("will not let a worker's session reach an operator-only route", async () => {
    const w = aWorker();
    await workerRequest.POST(json("http://x/api/auth/request", { did: w.did }));
    const signedIn = await workerRedeem.POST(
      json("http://x/api/auth/redeem", { did: w.did, code: codeFromFile(w.name) }),
    );
    const cookie = cookieFrom(signedIn)!;

    const res = await issue.POST(
      new Request("http://x/api/auth/issue", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ did: aWorker().did }),
      }),
    );
    // this is the failure the whole kind exists to prevent: a phone becoming
    // a console by presenting its cookie at a different door
    expect(res.status).toBe(401);
  });

  it("will not let an operator's session act as a worker", async () => {
    const op = anOperator();
    const cookie = await signInOperator(op.did, op.name);

    const res = await shifts.GET(new Request("http://x/api/shifts", { headers: { cookie } }));
    // an operator is not on the roster, has no credentials, and must not be
    // handed a board as though they were staff
    expect(res.status).toBe(401);
  });
});

describe("being signed in", () => {
  it("says which kind, so a screen cannot guess", async () => {
    const op = anOperator();
    const cookie = await signInOperator(op.did, op.name);

    const body = await (
      await session.GET(new Request("http://x/api/auth/session", { headers: { cookie } }))
    ).json();
    expect(body.kind).toBe("operator");
    expect(body.operator.name).toBe(op.name);
    expect(body.worker).toBeUndefined();
  });

  it("records the sign-in as a console one", async () => {
    const op = anOperator();
    await signInOperator(op.did, op.name);

    const e = (await (await (await store.eventStore()).all("org-test")))
      .filter((x) => x.type === "auth.signed_in" && x.data.via === "console")
      .at(-1)!;
    expect(e.actorDid).toBe(op.did);
    expect(e.summary).toMatch(/signed in to the console/);
    expect((await (await store.eventStore()).verify("org-test")).ok).toBe(true);
  });
});

describe("what the chain says a code was issued by", () => {
  it("names the operator who proved themselves, not a constant", async () => {
    const op = anOperator();
    const cookie = await signInOperator(op.did, op.name);
    const w = aWorker();

    const res = await issue.POST(
      new Request("http://x/api/auth/issue", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ did: w.did }),
      }),
    );
    expect(res.status).toBe(200);

    const e = (await (await store.eventStore()).all("org-test")).filter((x) => x.type === "auth.code_issued").at(-1)!;
    /* Until console sign-in existed this said CONSOLE_OPERATOR whoever was
       calling — a name that proved nothing, and the screen said so. */
    expect(e.actor).toBe(op.name);
    expect(e.actorDid).toBe(op.did);
    expect(e.subject).toBe(w.did);
  });
});

describe("the audit chain is not a worker surface", () => {
  /* The venue's compliance record — every break decision, every claim, every
     credential revocation, for everybody. Until console sign-in existed these
     routes asked nothing, which made this the first thing a worker reached
     after signing in on their phone. */

  it("refuses a worker the chain, and refuses a stranger too", async () => {
    const events = await import("../app/api/events/route");
    const w = aWorker();
    const wr = await import("../app/api/auth/request/route");
    const wrd = await import("../app/api/auth/redeem/route");
    await wr.POST(json("http://x/api/auth/request", { did: w.did }));
    const cookie = cookieFrom(
      await wrd.POST(json("http://x/api/auth/redeem", { did: w.did, code: codeFromFile(w.name) })),
    )!;

    expect((await events.GET(new Request("http://x/api/events", { headers: { cookie } }))).status).toBe(401);
    expect((await events.GET(new Request("http://x/api/events"))).status).toBe(401);
  });

  it("gives an operator the chain", async () => {
    const events = await import("../app/api/events/route");
    const op = anOperator();
    const cookie = await signInOperator(op.did, op.name);

    const res = await events.GET(new Request("http://x/api/events", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect((await res.json()).events.length).toBeGreaterThan(0);
  });

  it("gives a worker a tick on the stream, and nothing about anybody", async () => {
    const stream = await import("../app/api/events/stream/route");
    const w = aWorker();
    const wr = await import("../app/api/auth/request/route");
    const wrd = await import("../app/api/auth/redeem/route");
    await wr.POST(json("http://x/api/auth/request", { did: w.did }));
    const cookie = cookieFrom(
      await wrd.POST(json("http://x/api/auth/redeem", { did: w.did, code: codeFromFile(w.name) })),
    )!;

    const res = await stream.GET(
      new Request("http://x/api/events/stream?since=-1", { headers: { cookie } }),
    );
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const text = new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();

    /* The phone uses this only to know it is behind — es.onmessage refetches
       and never reads the payload — so a sequence number is the whole of what
       it needs and the whole of what it gets. */
    expect(text).toMatch(/^id: \d+\ndata: \{"seq":\d+\}\n\n/);
    expect(text).not.toMatch(/summary|actor|subject|hash/);
  });

  it("refuses the stream to somebody with no session at all", async () => {
    const stream = await import("../app/api/events/stream/route");
    expect((await stream.GET(new Request("http://x/api/events/stream"))).status).toBe(401);
  });
});

describe("what the middleware is not", () => {
  /* middleware.ts says it is a redirect and not a gate: it can only see that
     a cookie EXISTS, because the edge runtime has no node:sqlite. The claim
     that follows is that deleting it would authorise nothing.

     That claim was false when it was written. /api/breaks and
     /api/breaks/week asked nobody anything, so the redirect was the only
     thing in front of live venue data — a file documented as not-a-gate was
     the gate for exactly two routes, which is the worst place for an
     exception to live because the documentation says it is not there.

     So this checks the property route by route rather than trusting the
     comment, and it will fail the next time somebody adds an endpoint behind
     the matcher and forgets. */

  const noCookie = (url: string) => new Request(url);

  it("refuses the floor to somebody with no session", async () => {
    const breaks = await import("../app/api/breaks/route");
    const res = await breaks.GET(noCookie("http://x/api/breaks"));
    // who is on shift, when they clocked in, who is overdue
    expect(res.status).toBe(401);
  });

  it("refuses a priced week of the venue to somebody with no session", async () => {
    const week = await import("../app/api/breaks/week/route");
    const res = await week.GET(noCookie("http://x/api/breaks/week?start=0&end=1"));
    expect(res.status).toBe(401);
  });

  it("gives the floor to a supervisor's phone as well as the console", async () => {
    const breaks = await import("../app/api/breaks/route");
    const w = aWorker();
    const wr = await import("../app/api/auth/request/route");
    const wrd = await import("../app/api/auth/redeem/route");
    await wr.POST(json("http://x/api/auth/request", { did: w.did }));
    const cookie = cookieFrom(
      await wrd.POST(json("http://x/api/auth/redeem", { did: w.did, code: codeFromFile(w.name) })),
    )!;

    // operator-only here would take the break board off the floor, which is
    // where the six-hour mark is actually noticed
    const res = await breaks.GET(new Request("http://x/api/breaks", { headers: { cookie } }));
    expect(res.status).toBe(200);
  });

  it("keeps the priced week away from a worker", async () => {
    const week = await import("../app/api/breaks/week/route");
    const w = aWorker();
    const wr = await import("../app/api/auth/request/route");
    const wrd = await import("../app/api/auth/redeem/route");
    await wr.POST(json("http://x/api/auth/request", { did: w.did }));
    const cookie = cookieFrom(
      await wrd.POST(json("http://x/api/auth/redeem", { did: w.did, code: codeFromFile(w.name) })),
    )!;

    const res = await week.GET(
      new Request("http://x/api/breaks/week?start=0&end=1", { headers: { cookie } }),
    );
    expect(res.status).toBe(401);
  });
});

describe("every sign-in has a cause before it", () => {
  /* auth.code_issued is the cause and auth.signed_in is the effect, and a
     dispute is read against both. That only holds if EVERY path that mints a
     code records one — it was wired into the operator route when that was
     built and left out of the two self-request paths, so a worker asking for
     their own code produced an effect with nothing before it.

     Tested as a property over the whole chain rather than per route, because
     the failure was a route nobody thought to check, and a third minting path
     added later would reproduce it exactly. */

  it("records who caused it, however the code was obtained", async () => {
    const before = (await (await store.eventStore()).all("org-test")).length;

    // a worker asking for their own
    const w = aWorker();
    await workerRequest.POST(json("http://x/api/auth/request", { did: w.did }));
    await workerRedeem.POST(
      json("http://x/api/auth/redeem", { did: w.did, code: codeFromFile(w.name) }),
    );

    // an operator asking for their own
    const op = anOperator();
    await signInOperator(op.did, op.name);

    const fresh = (await (await store.eventStore()).all("org-test")).slice(before);
    const issued = fresh.filter((e) => e.type === "auth.code_issued");
    const signedIn = fresh.filter((e) => e.type === "auth.signed_in");

    expect(signedIn.length).toBe(2);
    expect(issued.length).toBe(2);

    // and each effect follows its own cause, by subject and by position
    for (const effect of signedIn) {
      const cause = issued.find((c) => c.subject === effect.subject);
      expect(cause, `no cause recorded for ${effect.actor}`).toBeTruthy();
      expect(cause!.seq).toBeLessThan(effect.seq);
      expect(cause!.data.trigger).toBe("self");
      // nobody authorised a self-request; inventing an operator would be a lie
      expect(cause!.actor).toBe("system");
    }
  });

  it("never lets the code into the chain, on any path", async () => {
    const w = aWorker();
    await workerRequest.POST(json("http://x/api/auth/request", { did: w.did }));
    const code = codeFromFile(w.name);

    const serialised = JSON.stringify((await (await store.eventStore()).all("org-test")));
    /* The audit screen is readable by every operator, so a code in the chain
       would be a credential published to the surface it protects. */
    expect(serialised).not.toContain(code.replace("-", ""));
    expect(serialised).not.toContain(code);
  });

  it("records one cause per grant, however often a phone retries", async () => {
    const w = aWorker();
    await workerRequest.POST(json("http://x/api/auth/request", { did: w.did }));
    const after = (await (await store.eventStore()).all("org-test")).filter((e) => e.type === "auth.code_issued").length;

    // the same grant, re-announced: a flaky connection must not double the log
    await workerRequest.POST(json("http://x/api/auth/request", { did: w.did }));
    const grants = (await (await store.eventStore()).all("org-test")).filter((e) => e.type === "auth.code_issued");
    // a second request mints a NEW grant, so this is 1 more, not 0 and not 2
    expect(grants.length).toBe(after + 1);
    expect(new Set(grants.map((g) => g.data.grantId)).size).toBe(grants.length);
  });
});
