import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { WORKERS } from "../lib/idara/seed";
import { OPERATORS } from "../lib/auth/operators";
import { signInOperator, asCaller, type TestSession } from "./sign-in-helper";

/* Issuing is an operator act now, so these go through a real operator
   session rather than relying on the route trusting whoever called it. */
let op: TestSession;
const OPERATOR = OPERATORS[0];

/* ============================================================
   POST /api/auth/issue — an operator minting a code for somebody
   else.

   The sibling of /api/auth/request, and the differences are the
   point. This one is done ON BEHALF OF a worker, so the chain gets
   the cause and not only the effect; it tells the operator the truth
   about an unknown name and about a refusal, where the phone
   endpoint deliberately hides both; and it must not become a new way
   to read a credential off the server, which is the bug closed twice
   already this morning.
   ============================================================ */

process.env.COVERS_DB = ":memory:";
process.env.COVERS_ORG = "org-test";

let issue: typeof import("../app/api/auth/issue/route");
let store: typeof import("../lib/store/events");

beforeAll(async () => {
  issue = await import("../app/api/auth/issue/route");
  store = await import("../lib/store/events");
  op = (await signInOperator(OPERATOR.did));
});

afterEach(() => vi.unstubAllEnvs());

let nextWorker = 0;
/** A different person per test: issuing is rate-limited per worker. */
const someone = () => WORKERS[nextWorker++ % WORKERS.length];

const post = (body: unknown) =>
  asCaller(op, "http://x/api/auth/issue", { method: "POST", body: JSON.stringify(body) });

const issueFor = async (did: string) => {
  const res = await issue.POST(post({ did }));
  return { res, body: await res.json() };
};

describe("minting for somebody", () => {
  it("returns the code to read aloud when nothing else can carry it", async () => {
    const w = someone();
    const { res, body } = await issueFor(w.did);

    expect(res.status).toBe(200);
    expect(body.worker.name).toBe(w.name);
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("names the identity it wrote into the chain, so the screen can show it", async () => {
    const { body } = await issueFor(someone().did);
    // no console sign-in exists, so this is whoever opened the page — and
    // saying the name is what makes that legible rather than reassuring
    expect(body.recordedAs.name).toBe(OPERATOR.name);
    expect(body.recordedAs.did).toBe(OPERATOR.did);
  });

  it("tells an operator plainly that a name is not one of ours", async () => {
    const res = await issue.POST(post({ did: "did:web:idara.app:w:nobody" }));
    // unlike the phone endpoint, there is nobody to protect from enumeration
    // here — the caller is looking at the list — and a mistype needs saying
    expect(res.status).toBe(404);
  });

  it("wants a did, and a body it can read", async () => {
    expect((await issue.POST(post({}))).status).toBe(400);
    expect(
      (
        await issue.POST(asCaller(op, "http://x/api/auth/issue", { method: "POST", body: "not json" }))
      ).status,
    ).toBe(400);
  });
});

describe("the cause, recorded", () => {
  it("writes who decided and who it was about", async () => {
    const w = someone();
    await issueFor(w.did);

    const e = (await (await store.eventStore()).all("org-test")).filter((x) => x.type === "auth.code_issued").at(-1)!;
    expect(e.actor).toBe(OPERATOR.name);
    expect(e.actorDid).toBe(OPERATOR.did);
    expect(e.subject).toBe(w.did);
    expect(e.summary).toContain(w.name);
    expect((await (await store.eventStore()).verify("org-test")).ok).toBe(true);
  });

  it("carries the grant id and no secret whatsoever", async () => {
    const w = someone();
    const { body } = await issueFor(w.did);

    const e = (await (await store.eventStore()).all("org-test")).filter((x) => x.type === "auth.code_issued").at(-1)!;
    expect(e.data.grantId).toMatch(/^sg-[0-9a-f]{16}$/);

    /* The audit screen is readable by anyone who can reach it, so a code in
       the chain would be a credential published to the surface it protects. */
    const serialised = JSON.stringify(e);
    const bare = (body.code as string).replace("-", "");
    expect(serialised).not.toContain(bare);
    expect(serialised).not.toContain(bare.slice(0, 4));
  });
});

describe("refusing, and saying so", () => {
  it("tells the operator when nothing was minted rather than staying quiet", async () => {
    const w = someone();
    for (let i = 0; i < 5; i++) await issueFor(w.did);

    const { res, body } = await issueFor(w.did);
    expect(res.status).toBe(429);
    expect(body.reason).toBe("rate_limited");
    expect(body.code).toBeUndefined();
    // silence here has somebody read out a code that does not exist
    expect(body.error).toContain(w.name);
    expect(body.detail).toMatch(/still valid/i);
  });

  it("records nothing when nothing was issued", async () => {
    const w = someone();
    for (let i = 0; i < 5; i++) await issueFor(w.did);
    const before = (await (await store.eventStore()).all("org-test")).filter((x) => x.type === "auth.code_issued").length;

    await issueFor(w.did);

    const after = (await (await store.eventStore()).all("org-test")).filter((x) => x.type === "auth.code_issued").length;
    // an issuance that did not happen is worse in the log than no entry at all
    expect(after).toBe(before);
  });

  it("refuses before minting when the server has no delivery channel", async () => {
    vi.stubEnv("AUTH_CODES_DIR", "");
    vi.stubEnv("AUTH_CODES_INLINE", "");
    vi.stubEnv("NODE_ENV", "production");

    const w = someone();
    const { res, body } = await issueFor(w.did);
    expect(res.status).toBe(503);
    expect(body.detail).toMatch(/AUTH_CODES_DIR/);

    // and no budget was spent on a code nobody could have received
    vi.unstubAllEnvs();
    expect((await issueFor(w.did)).res.status).toBe(200);
  });
});

describe("not becoming a new way to read a credential", () => {
  it("does not answer with the code when a real channel is configured", async () => {
    const dir = `${process.env.TEMP ?? "/tmp"}/covers-issue-test`;
    vi.stubEnv("AUTH_CODES_DIR", dir);

    const { res, body } = await issueFor(someone().did);
    expect(res.status).toBe(200);
    // the operator is told where it went, not what it is: an operator surface
    // answering with a live credential is the oracle in a nicer interface
    expect(body.code).toBeUndefined();
    expect(body.outOfBand).toBe(true);
    expect(body.via).toContain("covers-issue-test");
  });
});

describe("a mistyped directory", () => {
  it("does not cost a worker the code they already had", async () => {
    /* The failure this prevents, end to end. Before configured meant
       deliverable: the operator issues, the grant is spent, deliver() throws
       EEXIST, no auth.code_issued is written, and the worker's live code is
       dead with nothing to replace it. It presents as sign-in being broken
       rather than as a bad environment variable, which is why it would have
       taken a long time to attribute. */
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tmp = mkdtempSync(join(tmpdir(), "covers-badpath-"));
    const notADir = join(tmp, "oops");
    writeFileSync(notADir, "i am a file", "utf8");

    const w = someone();
    // a good code exists first, the way one would after a normal issue
    const good = await issueFor(w.did);
    expect(good.res.status).toBe(200);
    const before = (await (await store.eventStore()).all("org-test")).filter((x) => x.type === "auth.code_issued").length;

    try {
      vi.stubEnv("AUTH_CODES_DIR", notADir);
      const { res, body } = await issueFor(w.did);

      // refused at the gate, before anything was spent or written
      expect(res.status).toBe(503);
      expect(body.detail).toMatch(/AUTH_CODES_DIR/);
    } finally {
      vi.unstubAllEnvs();
      rmSync(tmp, { recursive: true, force: true });
    }

    // nothing recorded, because nothing happened
    const after = (await (await store.eventStore()).all("org-test")).filter((x) => x.type === "auth.code_issued").length;
    expect(after).toBe(before);

    // and the code the worker was already given still signs them in
    const { authStore } = await import("../lib/store/auth");
    expect((await (await authStore()).redeemCode(w.did, (good.body.code as string), "their-phone")).ok).toBe(true);
  });
});
