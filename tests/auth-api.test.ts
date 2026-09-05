import { describe, it, expect, beforeAll, vi } from "vitest";
import { COOKIE } from "../lib/auth/session";
import { WORKERS } from "../lib/idara/seed";

/* ============================================================
   Sign-in, through the real route handlers.

   The property worth proving here is not that signing in works —
   the store tests cover the mechanism. It is that the routes above
   it no longer accept an identity from whoever is calling. That was
   the hole: /api/shifts took a did from the query string and the
   claim endpoint acted on it, so any phone could put anybody's hand
   up and the chain would record it truthfully and uselessly.
   ============================================================ */

/* No database to point at any more: with no DATABASE_URL the store opens an
   in-process Postgres, and vitest gives each test FILE its own worker, so
   these routes get a database nobody else is writing to. Cases within one
   file do share it — the ones that care set their own org or clientRef. */
process.env.COVERS_ORG = "org-test";

let request: typeof import("../app/api/auth/request/route");
let redeem: typeof import("../app/api/auth/redeem/route");
let session: typeof import("../app/api/auth/session/route");
let link: typeof import("../app/api/auth/link/route");
let shifts: typeof import("../app/api/shifts/route");
let store: typeof import("../lib/store/events");

beforeAll(async () => {
  request = await import("../app/api/auth/request/route");
  redeem = await import("../app/api/auth/redeem/route");
  session = await import("../app/api/auth/session/route");
  link = await import("../app/api/auth/link/route");
  shifts = await import("../app/api/shifts/route");
  store = await import("../lib/store/events");
});

/* A different worker per test.

   Not fastidiousness: issuing is rate-limited per person, so a file that asked
   for six codes for Darie would start failing on the sixth — correctly, and
   for a reason that has nothing to do with what the test is checking. One
   worker each is also closer to what a venue looks like. */
let nextWorker = 0;
/* Wraps when the seed runs out, which is safe: with ten workers and a dozen
   allocations each person is asked for at most two codes, well inside the
   five-per-window limit. */
const someone = (): string => WORKERS[nextWorker++ % WORKERS.length].did;
const nameOf = (did: string): string => WORKERS.find((w) => w.did === did)!.name;

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const askFor = async (did: string) => {
  const res = await request.POST(json("http://x/api/auth/request", { did }));
  return { res, body: await res.json() };
};

/** The cookie a Set-Cookie header would leave on the device. */
const cookieFrom = (res: Response): string | null => {
  const set = res.headers.get("set-cookie");
  if (!set) return null;
  const v = set.split(";")[0];
  return v.startsWith(`${COOKIE}=`) && v.length > COOKIE.length + 1 ? v : null;
};

describe("asking for a code", () => {
  it("returns the code only because nothing else can carry it, and says so", async () => {
    const DARIE = someone();
    const { res, body } = await askFor(DARIE);
    expect(res.status).toBe(200);
    expect(body.sent).toBe(true);
    // no mail transport configured, so the sink hands it back — and the flag
    // is what stops a screen presenting that as though a channel verified it
    expect(body.outOfBand).toBe(false);
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("answers the same way for somebody who does not work here", async () => {
    const DARIE = someone();
    const known = await askFor(DARIE);
    const unknown = await askFor("did:web:idara.app:w:not-a-real-person");
    // a different answer here is a way to find out who works at the venue
    expect(unknown.res.status).toBe(known.res.status);
    expect(unknown.body.sent).toBe(true);
    expect(unknown.body.code).toBeUndefined();
  });

  it("wants a did", async () => {
    expect((await request.POST(json("http://x/api/auth/request", {}))).status).toBe(400);
  });
});

describe("redeeming a code", () => {
  it("sets a session cookie the browser will keep to itself", async () => {
    const DARIE = someone();
    const { body } = await askFor(DARIE);
    const res = await redeem.POST(json("http://x/api/auth/redeem", { did: DARIE, code: body.code }));
    expect(res.status).toBe(200);

    const set = res.headers.get("set-cookie") ?? "";
    // HttpOnly so a script cannot read it; Lax so another site cannot spend it
    expect(set).toContain("HttpOnly");
    expect(set.toLowerCase()).toContain("samesite=lax");
    // not Secure over plain http: this app is served on a venue LAN, and a
    // Secure cookie there is dropped — a sign-in that appears to work and does not
    expect(set).not.toContain("Secure");
  });

  it("refuses the wrong code without saying how wrong", async () => {
    const DARIE = someone();
    await askFor(DARIE);
    const res = await redeem.POST(json("http://x/api/auth/redeem", { did: DARIE, code: "AAAA-AAAA" }));
    expect(res.status).toBe(401);
    expect(cookieFrom(res)).toBeNull();
  });

  it("will not let one person redeem another's code", async () => {
    const DARIE = someone();
    const MITCH = someone();
    const { body } = await askFor(DARIE);
    const res = await redeem.POST(json("http://x/api/auth/redeem", { did: MITCH, code: body.code }));
    expect(res.status).toBe(401);
  });

  it("records that somebody signed in, without recording what let them", async () => {
    const DARIE = someone();
    const { body } = await askFor(DARIE);
    await redeem.POST(json("http://x/api/auth/redeem", { did: DARIE, code: body.code }));

    const events = (await (await store.eventStore()).all("org-test")).filter((e) => e.type === "auth.signed_in");
    expect(events.length).toBeGreaterThan(0);

    const e = events.at(-1)!;
    expect(e.actorDid).toBe(DARIE);
    // the fact belongs in the chain; the secret must never be able to get there
    const serialised = JSON.stringify(e);
    expect(serialised).not.toContain(body.code.replace("-", ""));
    expect((await (await store.eventStore()).verify("org-test")).ok).toBe(true);
  });
});

describe("the link", () => {
  it("signs in and redirects, leaving no secret in the destination", async () => {
    const DARIE = someone();
    // the link is minted by the request route; take it from the store's grant
    const { authStore } = await import("../lib/store/auth");
    const issued = (await (await authStore()).issue(DARIE));
    if (!issued.ok) throw new Error("rate limited");
    const grant = issued.grant;

    const res = await link.GET(new Request(`http://x/api/auth/link?t=${encodeURIComponent(grant.token)}`));
    expect(res.status).toBe(307);

    const to = res.headers.get("location")!;
    expect(to).toContain("/m/shifts");
    expect(to).not.toContain(grant.token);
    expect(cookieFrom(res)).toBeTruthy();
  });

  it("sends a stale link back to sign-in with a reason, not to an error page", async () => {
    const res = await link.GET(new Request("http://x/api/auth/link?t=nope"));
    expect(res.status).toBe(307);
    // somebody who clicked an old link wants the way back in
    expect(res.headers.get("location")).toContain("/m?signin=");
  });
});

describe("the session", () => {
  const signedIn = async (did: string) => {
    const { body } = await askFor(did);
    const res = await redeem.POST(json("http://x/api/auth/redeem", { did, code: body.code }));
    return cookieFrom(res)!;
  };

  it("says who you are, and says nobody when you are nobody", async () => {
    const DARIE = someone();
    const cookie = await signedIn(DARIE);

    const mine = await session.GET(new Request("http://x/api/auth/session", { headers: { cookie } }));
    expect((await mine.json()).worker.name).toBe(nameOf(DARIE));

    const anon = await session.GET(new Request("http://x/api/auth/session"));
    expect((await anon.json()).signedIn).toBe(false);
  });

  it("ends on sign-out, on the server and not only on the device", async () => {
    const DARIE = someone();
    const cookie = await signedIn(DARIE);
    await session.DELETE(new Request("http://x/api/auth/session", { method: "DELETE", headers: { cookie } }));

    // the same cookie replayed afterwards must be worth nothing — clearing it
    // client-side would leave a working secret in anything that copied it
    const after = await session.GET(new Request("http://x/api/auth/session", { headers: { cookie } }));
    expect((await after.json()).signedIn).toBe(false);
  });
});

describe("what the board will now answer", () => {
  it("shows nothing to a caller with no session", async () => {
    expect((await shifts.GET(new Request("http://x/api/shifts"))).status).toBe(401);
  });

  it("ignores a did in the URL entirely", async () => {
    const DARIE = someone();
    const MITCH = someone();
    const { body } = await askFor(MITCH);
    const cookie = cookieFrom(
      await redeem.POST(json("http://x/api/auth/redeem", { did: MITCH, code: body.code })),
    )!;

    // signed in as Mitch, asking for Darie's board
    const res = await shifts.GET(
      new Request(`http://x/api/shifts?did=${encodeURIComponent(DARIE)}`, { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    // the query string is not an identity and is not consulted
    expect((await res.json()).worker.name).toBe(nameOf(MITCH));
  });
});

describe("the default when nothing is configured", () => {
  /* The inline sink returns the code in the response body. As a silent
     production default that is an oracle, not a demo affordance: a POST with a
     guessable did — and a did is derivable from a name on the roster — hands a
     live sign-in code to anyone who can reach the server. The warning on the
     sign-in screen mitigates nothing, because an attacker is running curl and
     no screen is involved. */

  it("refuses to deliver at all in production rather than answering with a code", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await request.POST(json("http://x/api/auth/request", { did: someone() }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBeUndefined();
      expect(body.sent).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("still allows it when somebody has said so out loud", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_CODES_INLINE", "1");
    try {
      const res = await request.POST(json("http://x/api/auth/request", { did: someone() }));
      expect(res.status).toBe(200);
      expect((await res.json()).code).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("one person's fumbling", () => {
  it("does not lock out a colleague at the same venue", async () => {
    const clumsy = someone();
    const colleague = someone();
    const venue = { "x-forwarded-for": "203.0.113.7" };

    await request.POST(json("http://x/api/auth/request", { did: clumsy }));
    // a code read aloud across a bar, mistyped repeatedly
    for (let i = 0; i < 25; i++) {
      await redeem.POST(json("http://x/api/auth/redeem", { did: clumsy, code: "AAAA-AAAA" }, venue));
    }

    const { body } = await askFor(colleague);
    const res = await redeem.POST(
      json("http://x/api/auth/redeem", { did: colleague, code: body.code }, venue),
    );
    // same NAT, same window, and they did nothing
    expect(res.status).toBe(200);
  });
});
