/* ============================================================
   The event store — the one thing the server owns.

   Covers stores what happened, not what is: sessions stay
   Connecteam's and the assessment runs on each client, so the only
   durable state is the hash-chained log of consequential decisions.

   Backed by SQLite (node:sqlite, built into Node — no dependency and
   no infrastructure). Postgres is the eventual home; the DDL is in
   docs/plans/2026-09-03-break-compliance-backend-design.md and this
   module's surface is the seam it would swap behind.

   Chaining is delegated to lib/idara/audit.ts rather than
   reimplemented, so a chain written here and one built in memory are
   byte-identical and verifyChain() applies unchanged to both.
   ============================================================ */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";
import { appendEvent, verifyChain, type NewAuditEvent } from "@/lib/idara/audit";
import type { AuditEvent } from "@/lib/idara/types";

const DDL = `
CREATE TABLE IF NOT EXISTS audit_event (
  org_id      TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  id          TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  at          TEXT    NOT NULL,
  recorded_at TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  actor_did   TEXT,
  subject     TEXT,
  summary     TEXT    NOT NULL,
  data        TEXT    NOT NULL,
  prev_hash   TEXT    NOT NULL,
  hash        TEXT    NOT NULL,
  client_ref  TEXT,
  PRIMARY KEY (org_id, seq)
);

-- idempotency: a phone retrying a queued decision cannot tell a lost
-- request from a slow one, so the second append must be a no-op
CREATE UNIQUE INDEX IF NOT EXISTS audit_event_client_ref
  ON audit_event (org_id, client_ref) WHERE client_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS chain_head (
  org_id TEXT PRIMARY KEY,
  seq    INTEGER NOT NULL,
  hash   TEXT    NOT NULL
);
`;

export interface AppendOptions {
  /** Caller-minted id making the append idempotent under retry. */
  clientRef?: string;
}

export interface AppendResult {
  event: AuditEvent;
  /** when the row was written, which is later than `at` for a queued decision */
  recordedAt: string;
  /** true when this call created it; false when a clientRef matched an existing one. */
  created: boolean;
}

/**
 * Bring an existing database up to the current schema.
 *
 * CREATE TABLE IF NOT EXISTS is silent on a table that already exists, so a
 * database written before a column was added never receives it — and every
 * insert afterwards fails against a column list that no longer matches. That
 * is invisible in development, where the file gets deleted between runs, and
 * total in a deployment, where it does not.
 *
 * Each step checks the live schema rather than a stored version number, so it
 * stays correct for a database that has been through an unusual path, and is
 * safe to run on every open. Added columns must be nullable: existing rows get
 * NULL, which toEvent maps to undefined, so their digests are unchanged and
 * the chain keeps verifying.
 */
function migrate(db: DatabaseSync): void {
  const columns = (db.prepare("PRAGMA table_info(audit_event)").all() as { name: string }[]).map(
    (c) => c.name,
  );
  if (!columns.includes("actor_did")) {
    db.exec("ALTER TABLE audit_event ADD COLUMN actor_did TEXT");
  }
}

type Row = {
  seq: number; id: string; type: string; at: string; recorded_at: string;
  actor: string; actor_did: string | null; subject: string | null;
  summary: string; data: string;
  prev_hash: string; hash: string;
};

/**
 * When the row was stored, as distinct from when the thing happened. Kept
 * OUT of AuditEvent deliberately: verifyChain re-hashes the object it is
 * given, so an extra field on a chained event is indistinguishable from
 * tampering. Available on AppendResult and via withMeta().
 */
export interface EventMeta {
  event: AuditEvent;
  recordedAt: string;
}

function toEvent(r: Row): AuditEvent {
  return {
    seq: r.seq,
    id: r.id,
    type: r.type as AuditEvent["type"],
    at: r.at,
    actor: r.actor,
    // ?? undefined, never null: canonicalJson drops undefined keys and keeps
    // null ones, so a null here would re-hash every pre-existing event
    // differently and verifyChain would call the whole chain tampered
    actorDid: (r.actor_did ?? undefined) as AuditEvent["actorDid"],
    subject: (r.subject ?? undefined) as AuditEvent["subject"],
    summary: r.summary,
    data: JSON.parse(r.data) as Record<string, unknown>,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

export class EventStore {
  private db: DatabaseSync;
  private bus = new EventEmitter();

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // WAL lets readers proceed while a write transaction holds the chain
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
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(DDL);
    migrate(this.db);
    this.bus.setMaxListeners(0);
  }

  /**
   * Append one event, chained to the current head.
   *
   * The whole read-modify-write runs inside BEGIN IMMEDIATE, which takes the
   * write lock up front. That is the point: appendEvent() derives seq and
   * prevHash from the tail, so two writers reading the same tail would mint two
   * events claiming the same position and fork the chain. Serialised, they
   * queue instead — at roughly thirty events per venue per day, queueing costs
   * nothing and forking would cost the log its meaning.
   */
  append(orgId: string, ev: NewAuditEvent, opts: AppendOptions = {}): AppendResult {
    const ref = opts.clientRef ?? null;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (ref) {
        const existing = this.db
          .prepare("SELECT * FROM audit_event WHERE org_id = ? AND client_ref = ?")
          .get(orgId, ref) as Row | undefined;
        if (existing) {
          this.db.exec("COMMIT");
          return { event: toEvent(existing), recordedAt: existing.recorded_at, created: false };
        }
      }

      const head = this.db.prepare("SELECT * FROM chain_head WHERE org_id = ?").get(orgId) as
        | { seq: number; hash: string }
        | undefined;

      const tailRow = head
        ? (this.db.prepare("SELECT * FROM audit_event WHERE org_id = ? AND seq = ?").get(orgId, head.seq) as Row | undefined)
        : undefined;
      const tail: AuditEvent[] = tailRow ? [toEvent(tailRow)] : [];

      const next = appendEvent(tail, ev).at(-1) as AuditEvent;
      const recordedAt = new Date().toISOString();

      this.db
        .prepare(
          `INSERT INTO audit_event
             (org_id, seq, id, type, at, recorded_at, actor, actor_did, subject, summary, data, prev_hash, hash, client_ref)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(orgId, next.seq, next.id, next.type, next.at, recordedAt, next.actor,
             next.actorDid ?? null,
             next.subject ?? null, next.summary, JSON.stringify(next.data), next.prevHash, next.hash, ref);

      this.db
        .prepare(
          `INSERT INTO chain_head (org_id, seq, hash) VALUES (?,?,?)
             ON CONFLICT(org_id) DO UPDATE SET seq = excluded.seq, hash = excluded.hash`,
        )
        .run(orgId, next.seq, next.hash);

      this.db.exec("COMMIT");
      queueMicrotask(() => this.bus.emit("append", orgId, next));
      return { event: next, recordedAt, created: true };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Chain a starting set, but only into an empty chain.
   *
   * Demo data has to survive the move from memory to disk or every screen
   * comes up blank on a fresh database. Guarded on emptiness rather than a
   * flag: seeding twice would append the same history a second time, and the
   * chain would faithfully record that we did.
   */
  seedIfEmpty(orgId: string, events: NewAuditEvent[]): number {
    if (this.head(orgId)) return 0;
    for (const ev of events) this.append(orgId, ev);
    return events.length;
  }

  /**
   * Events after `seq`, oldest first. `since = -1` returns the whole chain.
   * Returns exactly what was hashed, so verifyChain() applies directly.
   */
  since(orgId: string, seq: number): AuditEvent[] {
    return (
      this.db
        .prepare("SELECT * FROM audit_event WHERE org_id = ? AND seq > ? ORDER BY seq")
        .all(orgId, seq) as Row[]
    ).map(toEvent);
  }

  all(orgId: string): AuditEvent[] {
    return this.since(orgId, -1);
  }

  /**
   * The event a given client ref already produced, if any.
   *
   * append() dedups on this ref internally, which is enough when the append is
   * the first thing a caller does. It is not enough when a caller must decide
   * something before appending: a claim that already landed is, on a retry,
   * indistinguishable from a duplicate request, and the caller would refuse a
   * write it had already made. Asking first lets a retry return the original
   * answer rather than an error about it.
   */
  byClientRef(orgId: string, clientRef: string): AuditEvent | null {
    const row = this.db
      .prepare("SELECT * FROM audit_event WHERE org_id = ? AND client_ref = ?")
      .get(orgId, clientRef) as Row | undefined;
    return row ? toEvent(row) : null;
  }

  head(orgId: string): { seq: number; hash: string } | null {
    return (
      (this.db.prepare("SELECT seq, hash FROM chain_head WHERE org_id = ?").get(orgId) as
        | { seq: number; hash: string }
        | undefined) ?? null
    );
  }

  /** Recompute the chain from storage — the same check the audit screen runs. */
  verify(orgId: string): { ok: boolean; brokenAt: number | null } {
    return verifyChain(this.all(orgId));
  }

  /** Events with their storage time, for showing how late a queued decision landed. */
  withMeta(orgId: string, seq = -1): EventMeta[] {
    return (
      this.db
        .prepare("SELECT * FROM audit_event WHERE org_id = ? AND seq > ? ORDER BY seq")
        .all(orgId, seq) as Row[]
    ).map((r) => ({ event: toEvent(r), recordedAt: r.recorded_at }));
  }

  /** Live appends, for the SSE fan-out. Returns an unsubscribe. */
  subscribe(orgId: string, fn: (e: AuditEvent) => void): () => void {
    const handler = (org: string, e: AuditEvent) => { if (org === orgId) fn(e); };
    this.bus.on("append", handler);
    return () => { this.bus.off("append", handler); };
  }

  close(): void {
    this.db.close();
  }
}

/* One store per process. Route handlers are re-entered per request, so the
   instance is cached on globalThis to survive Next's dev-mode module reloads. */
const KEY = Symbol.for("covers.eventStore");
type Holder = { [KEY]?: EventStore };

export function eventStore(): EventStore {
  const g = globalThis as unknown as Holder;
  return (g[KEY] ??= new EventStore(process.env.COVERS_DB ?? ".data/covers.db"));
}
