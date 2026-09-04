import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AuthStore } from "../lib/store/auth";
import {
  MAX_ATTEMPTS,
  TOKEN_TTL_SECONDS,
  formatCode,
  hash,
  mint,
  normaliseCode,
} from "../lib/auth/token";

/* ============================================================
   Sign-in.

   What replaced "pick your name from a list, and nothing checks".
   These are the tests the rest of the feature rests on, so they are
   written against the properties an attacker would go after rather
   than against the happy path: that a secret is spent when used,
   that a guess costs something, that the database holds nothing
   worth stealing, and that the answers given to a stranger do not
   tell them which guesses were close.
   ============================================================ */

const DARIE = "did:web:idara.app:w:darie-roberts";
const MITCH = "did:web:idara.app:w:mitch-egan";
const T = 1_800_000_000; // a fixed clock: expiry is a fact, not a race

let store: AuthStore;
beforeEach(() => { store = new AuthStore(":memory:"); });
afterEach(() => store.close());

describe("issuing a grant", () => {
  it("hands back a link and a code that are not the same secret", () => {
    const g = store.issue(DARIE, T);
    expect(g.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(g.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(g.expiresAt).toBe(T + TOKEN_TTL_SECONDS);
  });

  it("issues a code with no character anyone mishears", () => {
    // I/1 and O/0 read aloud across a bar are the same sound
    for (let i = 0; i < 200; i++) {
      expect(store.issue(DARIE, T).code).not.toMatch(/[IO01]/);
    }
  });

  it("replaces an outstanding grant rather than stacking a second", () => {
    const first = store.issue(DARIE, T);
    const second = store.issue(DARIE, T);
    // two live codes for one person is a support call and twice the guessing
    // surface; the older one is dead
    expect(store.redeemCode(DARIE, first.code, "ip", T).ok).toBe(false);
    expect(store.redeemCode(DARIE, second.code, "ip", T).ok).toBe(true);
  });
});

describe("what the database holds", () => {
  it("stores no secret that would let anyone sign in", () => {
    const g = store.issue(DARIE, T);
    // read the raw rows the way a dump or a leaked backup would
    const rows = JSON.stringify(
      (store as unknown as { db: { prepare(q: string): { all(): unknown[] } } }).db
        .prepare("SELECT * FROM signin_grant")
        .all(),
    );
    expect(rows).not.toContain(g.token);
    expect(rows).not.toContain(g.code);
    expect(rows).toContain(hash(g.code));
  });

  it("stores no session secret either", () => {
    const g = store.issue(DARIE, T);
    const r = store.redeemCode(DARIE, g.code, "ip", T);
    expect(r.ok).toBe(true);
    const secret = r.ok ? r.session.secret : "";
    const rows = JSON.stringify(
      (store as unknown as { db: { prepare(q: string): { all(): unknown[] } } }).db
        .prepare("SELECT * FROM session")
        .all(),
    );
    expect(rows).not.toContain(secret);
  });
});

describe("redeeming", () => {
  it("signs in the person the grant was for", () => {
    const g = store.issue(DARIE, T);
    const r = store.redeemCode(DARIE, g.code, "ip", T);
    expect(r).toMatchObject({ ok: true, did: DARIE });
  });

  it("accepts the code however it was typed", () => {
    for (const shape of [(c: string) => c, formatCode, (c: string) => c.toLowerCase(), (c: string) => ` ${formatCode(c)} `]) {
      const g = store.issue(DARIE, T);
      // adding the hyphen is not a wrong code, and must not spend a try
      expect(store.redeemCode(DARIE, shape(g.code), "ip", T).ok).toBe(true);
    }
  });

  it("spends the grant, so the same code cannot be used twice", () => {
    const g = store.issue(DARIE, T);
    expect(store.redeemCode(DARIE, g.code, "ip", T).ok).toBe(true);
    expect(store.redeemCode(DARIE, g.code, "ip", T)).toMatchObject({ ok: false });
  });

  it("refuses a code past its expiry", () => {
    const g = store.issue(DARIE, T);
    expect(store.redeemCode(DARIE, g.code, "ip", T + TOKEN_TTL_SECONDS + 1))
      .toMatchObject({ ok: false, reason: "expired" });
  });

  it("will not let one person redeem another's code", () => {
    const g = store.issue(DARIE, T);
    expect(store.redeemCode(MITCH, g.code, "ip", T)).toMatchObject({ ok: false });
    // and Darie's own code still works, so the attempt did not burn it
    expect(store.redeemCode(DARIE, g.code, "ip", T).ok).toBe(true);
  });

  it("redeems a link as well as a code", () => {
    const g = store.issue(DARIE, T);
    expect(store.redeemToken(g.token, T)).toMatchObject({ ok: true, did: DARIE });
    // one grant, two presentations: spending it either way spends it
    expect(store.redeemCode(DARIE, g.code, "ip", T)).toMatchObject({ ok: false });
  });

  it("gives one answer to a code that never existed and one typed wrongly", () => {
    store.issue(DARIE, T);
    const wrong = store.redeemCode(DARIE, "AAAAAAAA", "ip", T);
    const nobody = store.redeemCode(MITCH, "BBBBBBBB", "ip2", T);
    // telling these apart tells an attacker which names have a code waiting
    expect(wrong).toEqual({ ok: false, reason: "unknown" });
    expect(nobody).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("guessing", () => {
  it("kills the grant after five wrong tries", () => {
    const g = store.issue(DARIE, T);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(store.redeemCode(DARIE, "AAAAAAAA", `ip${i}`, T).ok).toBe(false);
    }
    // the real code no longer works: the budget is spent, not reset by luck
    expect(store.redeemCode(DARIE, g.code, "ip-last", T))
      .toMatchObject({ ok: false, reason: "too_many_attempts" });
  });

  it("throttles a caller who keeps failing, across different people", () => {
    // the per-grant limit only binds once a guess has found a real grant;
    // this is what stops someone walking the code space for free
    let throttled = false;
    for (let i = 0; i < 40 && !throttled; i++) {
      const r = store.redeemCode(`did:web:idara.app:w:nobody-${i}`, "AAAAAAAA", "one-address", T);
      throttled = !r.ok && r.reason === "too_many_attempts";
    }
    expect(throttled).toBe(true);
  });

  it("does not throttle a different caller", () => {
    for (let i = 0; i < 40; i++) store.redeemCode(DARIE, "AAAAAAAA", "noisy", T);
    const g = store.issue(MITCH, T);
    // one bad actor must not lock the venue out
    expect(store.redeemCode(MITCH, g.code, "quiet", T).ok).toBe(true);
  });
});

describe("sessions", () => {
  const signIn = (did = DARIE) => {
    const g = store.issue(did, T);
    const r = store.redeemCode(did, g.code, "ip", T);
    if (!r.ok) throw new Error("sign-in failed");
    return r.session;
  };

  it("resolves to the person who signed in", () => {
    const s = signIn();
    expect(store.resolve(s.secret, T)?.did).toBe(DARIE);
  });

  it("does not resolve a secret nobody issued", () => {
    signIn();
    expect(store.resolve(mint(T).token, T)).toBeNull();
  });

  it("stops resolving once revoked", () => {
    const s = signIn();
    expect(store.revoke(s.secret, T)).toBe(true);
    expect(store.resolve(s.secret, T)).toBeNull();
    // revoking twice is not an error, it is already true
    expect(store.revoke(s.secret, T)).toBe(false);
  });

  it("stops resolving once expired", () => {
    const s = signIn();
    expect(store.resolve(s.secret, s.expiresAt + 1)).toBeNull();
  });

  it("can sign out every device a person has", () => {
    const a = signIn();
    const b = signIn();
    expect(store.sessionsOf(DARIE, T)).toHaveLength(2);

    expect(store.revokeAllFor(DARIE, T)).toBe(2);
    expect(store.resolve(a.secret, T)).toBeNull();
    expect(store.resolve(b.secret, T)).toBeNull();
  });

  it("leaves other people's sessions alone", () => {
    const mine = signIn(DARIE);
    const theirs = signIn(MITCH);
    store.revokeAllFor(DARIE, T);
    expect(store.resolve(mine.secret, T)).toBeNull();
    expect(store.resolve(theirs.secret, T)?.did).toBe(MITCH);
  });
});

describe("housekeeping", () => {
  it("sweeps grants that are long dead", () => {
    store.issue(DARIE, T);
    expect(store.sweep(T + TOKEN_TTL_SECONDS + 3601)).toBe(1);
  });

  it("keeps a grant that is merely expired, so 'expired' can still be said", () => {
    const g = store.issue(DARIE, T);
    store.sweep(T + TOKEN_TTL_SECONDS + 1);
    // "that code has expired" is a better answer than "unknown", and it needs
    // the row to still be there to give it
    expect(store.redeemCode(DARIE, g.code, "ip", T + TOKEN_TTL_SECONDS + 1))
      .toMatchObject({ ok: false, reason: "expired" });
  });
});

describe("normalising what people type", () => {
  it("strips the decoration and nothing else", () => {
    expect(normaliseCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(normaliseCode("")).toBe("");
  });
});
