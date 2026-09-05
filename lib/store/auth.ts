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
import {
  MAX_ATTEMPTS,
  digestEquals,
  hash,
  mint,
  mintSession,
  normaliseCode,
  type MintedToken,
} from "@/lib/auth/token";
import { db, type Db } from "./db";

const DDL = `
CREATE TABLE IF NOT EXISTS signin_grant (
  id          TEXT PRIMARY KEY,
  did         TEXT   NOT NULL,
  token_hash  TEXT   NOT NULL,
  code_hash   TEXT   NOT NULL,
  issued_at   BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  -- what the resulting session is for. Never inferred at the point of use.
  kind        TEXT   NOT NULL DEFAULT 'worker',
  -- set the moment it is spent, so a second redemption of the same grant
  -- is refused by a fact rather than by the row being gone
  redeemed_at BIGINT
);

CREATE INDEX IF NOT EXISTS signin_grant_did ON signin_grant (did);
CREATE INDEX IF NOT EXISTS signin_grant_code ON signin_grant (code_hash);

CREATE TABLE IF NOT EXISTS session (
  id          TEXT   PRIMARY KEY,
  did         TEXT   NOT NULL,
  secret_hash TEXT   NOT NULL UNIQUE,
  issued_at   BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  last_seen   BIGINT NOT NULL,
  revoked_at  BIGINT,
  kind        TEXT   NOT NULL DEFAULT 'worker'
);

CREATE INDEX IF NOT EXISTS session_did ON session (did);

-- Failed redemptions, bucketed by caller. The per-grant attempt limit only
-- binds once a guess has found a real grant; this is what stops someone
-- walking the code space without ever consuming anyone.
CREATE TABLE IF NOT EXISTS redeem_attempt (
  bucket TEXT   NOT NULL,
  at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS redeem_attempt_bucket ON redeem_attempt (bucket, at);

/* Columns added after a database already existed. Postgres has
   ADD COLUMN IF NOT EXISTS, so this replaces the schema introspection the
   SQLite version needed — and it defaults to "worker", which is the only
   safe direction: an existing session predates operators entirely, and
   defaulting the other way would silently promote every live phone session
   to console access. */
ALTER TABLE session ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'worker';
ALTER TABLE signin_grant ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'worker';
`;

/**
 * What a credential is for.
 *
 * A session is not just "signed in" — it is signed in AS something. A worker's
 * phone session and an operator's console session are both a person proving
 * who they are, and they must not be interchangeable: an operator session
 * mints other people's credentials, and a worker session must never be able to
 * do that by being presented at a different door.
 *
 * So the kind is fixed when the grant is issued and carried through to the
 * session, rather than inferred at the point of use from which endpoint was
 * called. Inferring it there would mean every new endpoint had to remember,
 * and the one that forgot would be the hole.
 */
export type SessionKind = "worker" | "operator";

export interface Grant {
  id: string;
  did: string;
  kind: SessionKind;
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
  | { ok: true; did: string; kind: SessionKind; session: { id: string; secret: string; expiresAt: number } }
  | { ok: false; reason: "unknown" | "expired" | "spent" | "too_many_attempts" };

export interface Session {
  id: string;
  did: string;
  kind: SessionKind;
  issuedAt: number;
  expiresAt: number;
}

const now = () => Math.floor(Date.now() / 1000);

/** Throttle window, and how many failures one bucket gets inside it. */
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

type GrantRow = {
  id: string; did: string; token_hash: string; code_hash: string;
  issued_at: string | number; expires_at: string | number;
  attempts: number; redeemed_at: string | number | null; kind: SessionKind;
};

type SessionRow = {
  id: string; did: string; secret_hash: string;
  issued_at: string | number; expires_at: string | number;
  last_seen: string | number; revoked_at: string | number | null; kind: SessionKind;
};

/**
 * BIGINT comes back from node-postgres as a string, because it does not fit a
 * JS number in general. Every epoch here does fit, but comparing a string to a
 * number would silently do the wrong thing at some boundary rather than fail,
 * so every one is converted at the edge instead of trusted.
 */
const num = (v: string | number | null): number => (v === null ? 0 : Number(v));

export class AuthStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly database: Db) {}

  private async migrate(): Promise<void> {
    if (!this.ready) this.ready = this.database.exec(DDL);
    return this.ready;
  }

  /**
   * Issue a sign-in grant for a person.
   *
   * Any outstanding grant for the same person is spent first. Two live codes
   * for one worker is a support problem — "it says the code is wrong" when
   * they are reading the older of two texts — and it doubles the guessing
   * surface for no benefit.
   */
  async issue(did: string, kind: SessionKind = "worker", at = now()): Promise<IssueResult> {
    await this.migrate();
    await this.sweep(at);

    /* Refuse BEFORE spending anything. The order is the whole defence: a
       refusal that had already killed the outstanding grant would be the
       denial of service it exists to prevent, just with a different status
       code. */
    const count = await this.database.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM signin_grant WHERE did = $1 AND issued_at >= $2",
      [did, at - ISSUE_WINDOW_SECONDS],
    );
    if (Number(count.rows[0].n) >= MAX_ISSUES_PER_WINDOW) {
      return { ok: false, reason: "rate_limited" };
    }

    await this.database.query(
      "UPDATE signin_grant SET redeemed_at = $1 WHERE did = $2 AND redeemed_at IS NULL",
      [at, did],
    );

    const minted: MintedToken = mint(at);
    const id = `sg-${hash(minted.tokenHash).slice(0, 16)}`;
    await this.database.query(
      `INSERT INTO signin_grant (id, did, token_hash, code_hash, issued_at, expires_at, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, did, minted.tokenHash, minted.codeHash, at, minted.expiresAt, kind],
    );

    return {
      ok: true,
      grant: { id, did, kind, token: minted.token, code: minted.code, expiresAt: minted.expiresAt },
    };
  }

  /** Redeem a link secret. */
  async redeemToken(token: string, at = now()): Promise<RedeemResult> {
    await this.migrate();
    const r = await this.database.query<GrantRow>(
      "SELECT * FROM signin_grant WHERE token_hash = $1",
      [hash(token)],
    );
    return this.consume(r.rows[0], at);
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
  async redeemCode(did: string, input: string, bucket = "anon", at = now()): Promise<RedeemResult> {
    await this.migrate();
    if (await this.throttled(bucket, at)) return { ok: false, reason: "too_many_attempts" };

    const code = normaliseCode(input);
    if (!code) return this.failed(bucket, at, "unknown");

    const r = await this.database.query<GrantRow>(
      "SELECT * FROM signin_grant WHERE did = $1 AND redeemed_at IS NULL ORDER BY issued_at DESC",
      [did],
    );
    const row = r.rows[0];

    /* No grant and a wrong code are one answer to the person in front of us,
       and must be: telling them apart says which names have a code waiting. */
    if (!row) return this.failed(bucket, at, "unknown");

    // counted before the comparison, so a guess costs a try whatever the
    // outcome — counting only failures leaves unlimited guessing to whoever
    // never succeeds, which is the entire activity
    await this.database.query("UPDATE signin_grant SET attempts = attempts + 1 WHERE id = $1", [row.id]);
    if (row.attempts + 1 > MAX_ATTEMPTS) return this.failed(bucket, at, "too_many_attempts");
    if (!digestEquals(row.code_hash, hash(code))) return this.failed(bucket, at, "unknown");

    return this.consume(row, at);
  }

  /** Record a failed redemption and return the reason to the caller. */
  private async failed(
    bucket: string,
    at: number,
    reason: "unknown" | "too_many_attempts",
  ): Promise<RedeemResult> {
    await this.database.query("INSERT INTO redeem_attempt (bucket, at) VALUES ($1,$2)", [bucket, at]);
    return { ok: false, reason };
  }

  /** Has this caller failed too often lately? */
  private async throttled(bucket: string, at: number): Promise<boolean> {
    await this.database.query("DELETE FROM redeem_attempt WHERE at < $1", [at - THROTTLE_WINDOW_SECONDS]);
    const r = await this.database.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM redeem_attempt WHERE bucket = $1 AND at >= $2",
      [bucket, at - THROTTLE_WINDOW_SECONDS],
    );
    return Number(r.rows[0].n) >= MAX_FAILURES_PER_WINDOW;
  }

  private async consume(row: GrantRow | undefined, at: number): Promise<RedeemResult> {
    if (!row) return { ok: false, reason: "unknown" };
    if (row.redeemed_at !== null) return { ok: false, reason: "spent" };
    if (num(row.expires_at) <= at) return { ok: false, reason: "expired" };
    if (row.attempts > MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

    /* Spend it and mint the session in one transaction. Two requests racing
       the same link — the phone's browser prefetching it, say — must produce
       one session, not two.

       The UPDATE's WHERE clause carries the race: only one of them finds
       redeemed_at still NULL, and the other sees zero rows changed. That is
       the check, not the read above it, which is why the read being stale is
       harmless. */
    return this.database.transaction(async (tx) => {
      const spent = await tx.query(
        "UPDATE signin_grant SET redeemed_at = $1 WHERE id = $2 AND redeemed_at IS NULL",
        [at, row.id],
      );
      if (spent.rowCount === 0) return { ok: false, reason: "spent" as const };

      const s = mintSession(at);
      const id = `ses-${hash(s.secretHash).slice(0, 16)}`;
      await tx.query(
        `INSERT INTO session (id, did, secret_hash, issued_at, expires_at, last_seen, kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, row.did, s.secretHash, at, s.expiresAt, at, row.kind],
      );

      return {
        ok: true as const,
        did: row.did,
        kind: row.kind,
        session: { id, secret: s.secret, expiresAt: s.expiresAt },
      };
    });
  }

  /** Who this session secret belongs to, or null if it is not a live one. */
  async resolve(secret: string, at = now()): Promise<Session | null> {
    await this.migrate();
    const r = await this.database.query<SessionRow>(
      "SELECT * FROM session WHERE secret_hash = $1",
      [hash(secret)],
    );
    const row = r.rows[0];
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (num(row.expires_at) <= at) return null;

    await this.database.query("UPDATE session SET last_seen = $1 WHERE id = $2", [at, row.id]);
    return {
      id: row.id, did: row.did, kind: row.kind,
      issuedAt: num(row.issued_at), expiresAt: num(row.expires_at),
    };
  }

  /** Sign out. Revoking rather than deleting keeps the row auditable. */
  async revoke(secret: string, at = now()): Promise<boolean> {
    await this.migrate();
    const r = await this.database.query(
      "UPDATE session SET revoked_at = $1 WHERE secret_hash = $2 AND revoked_at IS NULL",
      [at, hash(secret)],
    );
    return r.rowCount > 0;
  }

  /** Every live session for a person — for "sign out my other devices". */
  async sessionsOf(did: string, at = now()): Promise<Session[]> {
    await this.migrate();
    const r = await this.database.query<SessionRow>(
      "SELECT * FROM session WHERE did = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY issued_at DESC",
      [did, at],
    );
    return r.rows.map((row) => ({
      id: row.id, did: row.did, kind: row.kind,
      issuedAt: num(row.issued_at), expiresAt: num(row.expires_at),
    }));
  }

  async revokeAllFor(did: string, at = now()): Promise<number> {
    await this.migrate();
    const r = await this.database.query(
      "UPDATE session SET revoked_at = $1 WHERE did = $2 AND revoked_at IS NULL",
      [at, did],
    );
    return r.rowCount;
  }

  /**
   * Drop grants that are long dead.
   *
   * An expired grant is already refused by consume(), so this is hygiene
   * rather than security — but a table that only grows is a table nobody
   * looks at, and the codes are the one thing here worth not hoarding.
   */
  async sweep(at = now()): Promise<number> {
    await this.migrate();
    const r = await this.database.query("DELETE FROM signin_grant WHERE expires_at < $1", [at - 3600]);
    return r.rowCount;
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}

/* One instance per process, cached across dev-server hot reloads: a new
   connection pool per reload would leak the previous one. */
const KEY = Symbol.for("covers.authStore");
type Holder = { [KEY]?: Promise<AuthStore> };

export function authStore(): Promise<AuthStore> {
  const g = globalThis as Holder;
  if (!g[KEY]) g[KEY] = db().then((d) => new AuthStore(d));
  return g[KEY];
}
