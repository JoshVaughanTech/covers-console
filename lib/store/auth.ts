/* ============================================================
   Sign-in grants and sessions.

   Deliberately NOT in the audit chain, which is where every other
   consequential fact in this system lives. The chain is append-only
   and tamper-evident, and both properties are wrong here: a one-time
   secret has to stop working, and a session has to be revocable.
   Something you must be able to delete cannot live in a log whose
   value is that nothing can be deleted from it.

   What does belong in the chain is that somebody signed in — that is
   a fact about a person, it never stops being true, and the routes
   append it. The secret that let them is this module's business and
   goes no further.

   Only digests are stored. A dump of this database yields nobody a
   working link, a usable code or a live session; it yields the fact
   that grants exist and when they expire, which is what a support
   conversation needs anyway.
   ============================================================ */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  MAX_ATTEMPTS,
  digestEquals,
  hash,
  mint,
  mintSession,
  normaliseCode,
  type MintedToken,
} from "@/lib/auth/token";

const DDL = `
CREATE TABLE IF NOT EXISTS signin_grant (
  id          TEXT PRIMARY KEY,
  did         TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL,
  code_hash   TEXT    NOT NULL,
  issued_at   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  -- set the moment it is spent, so a second redemption of the same grant
  -- is refused by a fact rather than by the row being gone
  redeemed_at INTEGER
);

CREATE INDEX IF NOT EXISTS signin_grant_did ON signin_grant (did);
CREATE INDEX IF NOT EXISTS signin_grant_code ON signin_grant (code_hash);

CREATE TABLE IF NOT EXISTS session (
  id          TEXT PRIMARY KEY,
  did         TEXT    NOT NULL,
  secret_hash TEXT    NOT NULL UNIQUE,
  issued_at   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE INDEX IF NOT EXISTS session_did ON session (did);

-- Failed redemptions, bucketed by caller. The per-grant attempt limit only
-- binds once a guess has found a real grant; this is what stops someone
-- walking the code space without ever consuming anyone.
CREATE TABLE IF NOT EXISTS redeem_attempt (
  bucket TEXT    NOT NULL,
  at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS redeem_attempt_bucket ON redeem_attempt (bucket, at);
`;

export interface Grant {
  id: string;
  did: string;
  /** the plaintext link secret. Returned once, at issue, and never again. */
  token: string;
  /** the plaintext code. Returned once, at issue, and never again. */
  code: string;
  expiresAt: number;
}

/**
 * The outcome of asking for a code.
 *
 * Not a bare Grant, because refusing has to be expressible. Issuing spends any
 * outstanding grant, so an unthrottled issue endpoint is a denial of service on
 * sign-in: loop requests for somebody and their code is dead before they can
 * type it. A caller that could not be told "no" could not defend against that.
 */
export type IssueResult =
  | { ok: true; grant: Grant }
  | { ok: false; reason: "rate_limited" };

export type RedeemResult =
  | { ok: true; did: string; session: { id: string; secret: string; expiresAt: number } }
  | { ok: false; reason: "unknown" | "expired" | "spent" | "too_many_attempts" };

export interface Session {
  id: string;
  did: string;
  issuedAt: number;
  expiresAt: number;
}

const now = () => Math.floor(Date.now() / 1000);

/**
 * Throttle window, and how many failures one bucket gets inside it.
 *
 * The bucket is per caller AND per person, not per caller alone. A venue is
 * one IP: bucketing on the address alone means four people fumbling their five
 * attempts locks out everyone behind that NAT, and eight characters read aloud
 * across a bar makes that an ordinary Friday rather than an attack. The people
 * locked out did nothing.
 *
 * The address half is also weaker than it looks — x-forwarded-for is
 * client-supplied unless a trusted proxy overwrites it, so a caller can mint a
 * fresh bucket per request. That is survivable because it is not the control
 * doing the work: redeeming requires the did, and each person has their own
 * five attempts. This is a flood ceiling, documented as one rather than
 * relied on as a gate.
 */
const THROTTLE_WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES_PER_WINDOW = 20;

/**
 * How many codes one person can be issued in a window.
 *
 * Five is generous for a human — a mistyped code, an expired one, a phone that
 * lost the page — and the number matters less than what happens at the limit:
 * a refusal does not spend the grant already outstanding. So an attacker can
 * burn the budget, and the last code issued stays live for the rest of the
 * window, which is the one the manager is reading out.
 */
const ISSUE_WINDOW_SECONDS = 15 * 60;
const MAX_ISSUES_PER_WINDOW = 5;

export class AuthStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    /* Two connections now open this file — the event store and the auth
       store — so a write can meet another write. Without a busy timeout
       SQLite returns SQLITE_BUSY at once rather than waiting, which would
       surface as a sign-in or a claim failing under load for no reason a
       user could act on.

       Five seconds is not a round number picked for looking sensible. Every
       write here is one INSERT and one UPDATE inside a transaction, so real
       overlap is sub-millisecond and this is about four orders of magnitude
       of headroom. The number is chosen for what happens when it is NOT
       enough: waiting and succeeding beats failing at the six-hour mark,
       because the cost of a spurious failure is a supervisor who cannot send
       a break or a casual who cannot claim a shift. The trade is that a
       genuinely stuck lock now presents as a slow request rather than a fast
       error, and slow is harder to attribute — but a stuck lock is a bug to
       find either way, and it should not take a worker down with it. */
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(DDL);
  }

  /**
   * Issue a sign-in grant for a person.
   *
   * Any outstanding grant for the same person is spent first. Two live codes
   * for one worker is a support problem — "it says the code is wrong" when
   * they are reading the older of two texts — and it doubles the guessing
   * surface for no benefit.
   */
  issue(did: string, at = now()): IssueResult {
    this.sweep(at);

    /* Refuse BEFORE spending anything. The order is the whole defence: a
       refusal that had already killed the outstanding grant would be the
       denial of service it exists to prevent, just with a different status
       code. */
    const { n } = this.db
      .prepare("SELECT COUNT(*) AS n FROM signin_grant WHERE did = ? AND issued_at >= ?")
      .get(did, at - ISSUE_WINDOW_SECONDS) as { n: number };
    if (n >= MAX_ISSUES_PER_WINDOW) return { ok: false, reason: "rate_limited" };

    this.db.prepare("UPDATE signin_grant SET redeemed_at = ? WHERE did = ? AND redeemed_at IS NULL")
      .run(at, did);

    const minted: MintedToken = mint(at);
    const id = `sg-${hash(minted.tokenHash).slice(0, 16)}`;
    this.db
      .prepare(
        `INSERT INTO signin_grant (id, did, token_hash, code_hash, issued_at, expires_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(id, did, minted.tokenHash, minted.codeHash, at, minted.expiresAt);

    return {
      ok: true,
      grant: { id, did, token: minted.token, code: minted.code, expiresAt: minted.expiresAt },
    };
  }

  /** Redeem a link secret. */
  redeemToken(token: string, at = now()): RedeemResult {
    const row = this.db
      .prepare("SELECT * FROM signin_grant WHERE token_hash = ?")
      .get(hash(token)) as GrantRow | undefined;
    return this.consume(row, at);
  }

  /**
   * Redeem a code, for a stated person.
   *
   * The did is required, and that is the point rather than a convenience.
   * Looked up by code alone, a wrong guess matches no grant and so costs no
   * attempt from anybody — the five-try limit binds only once a guesser has
   * already found a real grant, which is the moment it stops mattering.
   * Scoped to a person, every guess spends one of that person's five.
   *
   * Saying who you are is not claiming to be them. It is addressing, which
   * is what picking a name from a list always was; the code is the proof.
   *
   * The bucket identifies the caller for throttling — an address, normally.
   */
  redeemCode(did: string, input: string, bucket = "anon", at = now()): RedeemResult {
    if (this.throttled(bucket, at)) return { ok: false, reason: "too_many_attempts" };

    const code = normaliseCode(input);
    if (!code) return this.failed(bucket, at, "unknown");

    const row = this.db
      .prepare("SELECT * FROM signin_grant WHERE did = ? AND redeemed_at IS NULL ORDER BY issued_at DESC")
      .get(did) as GrantRow | undefined;

    /* No grant and a wrong code are one answer to the person in front of us,
       and must be: telling them apart says which names have a code waiting. */
    if (!row) return this.failed(bucket, at, "unknown");

    // counted before the comparison, so a guess costs a try whatever the
    // outcome — counting only failures leaves unlimited guessing to whoever
    // never succeeds, which is the entire activity
    this.db.prepare("UPDATE signin_grant SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    if (row.attempts + 1 > MAX_ATTEMPTS) return this.failed(bucket, at, "too_many_attempts");
    if (!digestEquals(row.code_hash, hash(code))) return this.failed(bucket, at, "unknown");

    return this.consume(row, at);
  }

  /** Record a failed redemption and return the reason to the caller. */
  private failed(bucket: string, at: number, reason: "unknown" | "too_many_attempts"): RedeemResult {
    this.db.prepare("INSERT INTO redeem_attempt (bucket, at) VALUES (?,?)").run(bucket, at);
    return { ok: false, reason };
  }

  /** Has this caller failed too often lately? */
  private throttled(bucket: string, at: number): boolean {
    this.db.prepare("DELETE FROM redeem_attempt WHERE at < ?").run(at - THROTTLE_WINDOW_SECONDS);
    const { n } = this.db
      .prepare("SELECT COUNT(*) AS n FROM redeem_attempt WHERE bucket = ? AND at >= ?")
      .get(bucket, at - THROTTLE_WINDOW_SECONDS) as { n: number };
    return n >= MAX_FAILURES_PER_WINDOW;
  }

  private consume(row: GrantRow | undefined, at: number): RedeemResult {
    if (!row) return { ok: false, reason: "unknown" };
    if (row.redeemed_at !== null) return { ok: false, reason: "spent" };
    if (row.expires_at <= at) return { ok: false, reason: "expired" };
    if (row.attempts > MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

    /* Spend it and mint the session in one transaction. Two requests racing
       the same link — the phone's browser prefetching it, say — must produce
       one session, not two. */
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const spent = this.db
        .prepare("UPDATE signin_grant SET redeemed_at = ? WHERE id = ? AND redeemed_at IS NULL")
        .run(at, row.id);
      if (spent.changes === 0) {
        this.db.exec("ROLLBACK");
        return { ok: false, reason: "spent" };
      }

      const s = mintSession(at);
      const id = `ses-${hash(s.secretHash).slice(0, 16)}`;
      this.db
        .prepare(
          `INSERT INTO session (id, did, secret_hash, issued_at, expires_at, last_seen)
           VALUES (?,?,?,?,?,?)`,
        )
        .run(id, row.did, s.secretHash, at, s.expiresAt, at);
      this.db.exec("COMMIT");

      return { ok: true, did: row.did, session: { id, secret: s.secret, expiresAt: s.expiresAt } };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Who this session secret belongs to, or null if it is not a live one. */
  resolve(secret: string, at = now()): Session | null {
    const row = this.db
      .prepare("SELECT * FROM session WHERE secret_hash = ?")
      .get(hash(secret)) as SessionRow | undefined;
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (row.expires_at <= at) return null;

    this.db.prepare("UPDATE session SET last_seen = ? WHERE id = ?").run(at, row.id);
    return { id: row.id, did: row.did, issuedAt: row.issued_at, expiresAt: row.expires_at };
  }

  /** Sign out. Revoking rather than deleting keeps the row auditable. */
  revoke(secret: string, at = now()): boolean {
    const r = this.db
      .prepare("UPDATE session SET revoked_at = ? WHERE secret_hash = ? AND revoked_at IS NULL")
      .run(at, hash(secret));
    return r.changes > 0;
  }

  /** Every live session for a person — for "sign out my other devices". */
  sessionsOf(did: string, at = now()): Session[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM session WHERE did = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY issued_at DESC",
        )
        .all(did, at) as SessionRow[]
    ).map((r) => ({ id: r.id, did: r.did, issuedAt: r.issued_at, expiresAt: r.expires_at }));
  }

  revokeAllFor(did: string, at = now()): number {
    return this.db
      .prepare("UPDATE session SET revoked_at = ? WHERE did = ? AND revoked_at IS NULL")
      .run(at, did).changes as number;
  }

  /**
   * Drop grants that are long dead.
   *
   * An expired grant is already refused by consume(), so this is hygiene
   * rather than security — but a table that only grows is a table nobody
   * looks at, and the codes are the one thing here worth not hoarding.
   */
  sweep(at = now()): number {
    return this.db.prepare("DELETE FROM signin_grant WHERE expires_at < ?").run(at - 3600)
      .changes as number;
  }

  close(): void {
    this.db.close();
  }
}

type GrantRow = {
  id: string; did: string; token_hash: string; code_hash: string;
  issued_at: number; expires_at: number; attempts: number; redeemed_at: number | null;
};

type SessionRow = {
  id: string; did: string; secret_hash: string;
  issued_at: number; expires_at: number; last_seen: number; revoked_at: number | null;
};

/* One instance per process, cached across dev-server hot reloads for the same
   reason the event store is: a new database handle per reload would leave the
   previous one open and lose whatever was in :memory:. */
const KEY = Symbol.for("covers.authStore");
type Holder = { [KEY]?: AuthStore };

export function authStore(): AuthStore {
  const g = globalThis as Holder;
  if (!g[KEY]) g[KEY] = new AuthStore(process.env.COVERS_DB ?? ".data/covers.db");
  return g[KEY];
}
