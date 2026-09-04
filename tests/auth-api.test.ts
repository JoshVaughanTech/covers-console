import { describe, it, expect, beforeAll } from "vitest";
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

process.env.COVERS_DB = ":memory:";
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

const DARIE = WORKERS.find((w) => w.name === "Darie Roberts")!.did;
const MITCH = WORKERS.find((w) => w.name === "Mitch Egan")!.did;

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
    const { res, body } = await askFor(DARIE);
    expect(res.status).toBe(200);
    expect(body.sent).toBe(true);
    // no mail transport configured, so the sink hands it back — and the flag
    // is what stops a screen presenting that as though a channel verified it
    expect(body.outOfBand).toBe(false);
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("answers the same way for somebody who does not work here", async () => {
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
    await askFor(DARIE);
    const res = await redeem.POST(json("http://x/api/auth/redeem", { did: DARIE, code: "AAAA-AAAA" }));
    expect(res.status).toBe(401);
    expect(cookieFrom(res)).toBeNull();
  });

  it("will not let one person redeem another's code", async () => {
    const { body } = await askFor(DARIE);
    const res = await redeem.POST(json("http://x/api/auth/redeem", { did: MITCH, code: body.code }));
    expect(res.status).toBe(401);
  });

  it("records that somebody signed in, without recording what let them", async () => {
    const { body } = await askFor(DARIE);
    await redeem.POST(json("http://x/api/auth/redeem", { did: DARIE, code: body.code }));

    const events = store.eventStore().all("org-test").filter((e) => e.type === "auth.signed_in");
    expect(events.length).toBeGreaterThan(0);

    const e = events.at(-1)!;
    expect(e.actorDid).toBe(DARIE);
    // the fact belongs in the chain; the secret must never be able to get there
    const serialised = JSON.stringify(e);
    expect(serialised).not.toContain(body.code.replace("-", ""));
    expect(store.eventStore().verify("org-test").ok).toBe(true);
  });
});

describe("the link", () => {
  it("signs in and redirects, leaving no secret in the destination", async () => {
    // the link is minted by the request route; take it from the store's grant
    const { authStore } = await import("../lib/store/auth");
    const grant = authStore().issue(DARIE);

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
    const cookie = await signedIn(DARIE);

    const mine = await session.GET(new Request("http://x/api/auth/session", { headers: { cookie } }));
    expect((await mine.json()).worker.name).toBe("Darie Roberts");

    const anon = await session.GET(new Request("http://x/api/auth/session"));
    expect((await anon.json()).signedIn).toBe(false);
  });

  it("ends on sign-out, on the server and not only on the device", async () => {
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
    expect((await res.json()).worker.name).toBe("Mitch Egan");
  });
});
