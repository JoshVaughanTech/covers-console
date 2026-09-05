/* ============================================================
   The event store — the one thing the server owns.

   Covers stores what happened, not what is: sessions stay
   Connecteam's and the assessment runs on each client, so the only
   durable state is the hash-chained log of consequential decisions.

   Postgres, because the deployment target is serverless and a file
   on local disk does not survive there. SQLite was right while this
   ran on one machine and became wrong the moment more than one
   process served the same venue.

   Chaining is delegated to lib/idara/audit.ts rather than
   reimplemented, so a chain written here and one built in memory are
   byte-identical and verifyChain() applies unchanged to both.

   ONE THING THAT CHANGED IN THE MOVE, and it is worth knowing
   before somebody relies on it: subscribe() notifies listeners in
   THIS process. On one machine that is every listener. Behind
   several serverless instances it is not — a stream held by one
   instance will not see an append made by another until the client
   reconnects and replays from its cursor, which it does on its own.
   The SSE contract still holds because Last-Event-ID drives a
   replay; what is lost is immediacy, not events. Making it truly
   cross-instance wants LISTEN/NOTIFY on a dedicated connection,
   which a transaction pooler will not give us.
   ============================================================ */
import { appendEvent, verifyChain, type NewAuditEvent } from "@/lib/idara/audit";
import type { AuditEvent } from "@/lib/idara/types";
import { EventEmitter } from "node:events";
import { db, withChainLock, type Db } from "./db";

const DDL = `
CREATE TABLE IF NOT EXISTS audit_event (
  org_id      TEXT    NOT NULL,
  seq         BIGINT  NOT NULL,
  id          TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  at          TEXT    NOT NULL,
  recorded_at TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  actor_did   TEXT,
  subject     TEXT,
  summary     TEXT    NOT NULL,
  data        JSONB   NOT NULL,
  prev_hash   TEXT    NOT NULL,
  hash        TEXT    NOT NULL,
  client_ref  TEXT,
  PRIMARY KEY (org_id, seq)
);

-- idempotency: a phone retrying a queued decision cannot tell a lost
-- request from a slow one, so the second append must be a no-op
CREATE UNIQUE INDEX IF NOT EXISTS audit_event_client_ref
  ON audit_event (org_id, client_ref) WHERE client_ref IS NOT NULL;

/* CREATE TABLE IF NOT EXISTS is silent on a table that already exists, so a
   database written before a column was added never receives it — and every
   insert afterwards fails against a column list that no longer matches. That
   is invisible in development, where the database is thrown away between
   runs, and total in a deployment, where it is not.

   Postgres has ADD COLUMN IF NOT EXISTS, so unlike the SQLite version this
   needs no schema probe: it is idempotent and safe on every open. The column
   must stay nullable — existing rows get NULL, which toEvent maps to
   undefined, so their digests are unchanged and the chain keeps verifying. */
ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS actor_did TEXT;

CREATE TABLE IF NOT EXISTS chain_head (
  org_id TEXT PRIMARY KEY,
  seq    BIGINT NOT NULL,
  hash   TEXT   NOT NULL
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
 * When the row was stored, as distinct from when the thing happened. Kept
 * OUT of AuditEvent deliberately: verifyChain re-hashes the object it is
 * given, so an extra field on a chained event is indistinguishable from
 * tampering.
 */
export interface EventMeta {
  event: AuditEvent;
  recordedAt: string;
}

type Row = {
  seq: string | number; id: string; type: string; at: string; recorded_at: string;
  actor: string; actor_did: string | null; subject: string | null;
  summary: string; data: Record<string, unknown>;
  prev_hash: string; hash: string;
};

function toEvent(r: Row): AuditEvent {
  return {
    // BIGINT arrives as a string from node-postgres; a seq compared as text
    // would order 10 before 9 and the chain would read as broken
    seq: Number(r.seq),
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
    data: r.data,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

export class EventStore {
  private bus = new EventEmitter();
  private ready: Promise<void> | null = null;

  constructor(private readonly database: Db) {
    this.bus.setMaxListeners(0);
  }

  /** Create the tables once per process, not once per query. */
  private async migrate(): Promise<void> {
    if (!this.ready) this.ready = this.database.exec(DDL);
    return this.ready;
  }

  /**
   * Append one event, chained to the current head.
   *
   * The whole read-modify-write runs inside a transaction holding an advisory
   * lock on the org. That is the point: appendEvent() derives seq and prevHash
   * from the tail, so two writers reading the same tail would mint two events
   * claiming the same position and fork the chain. Serialised, they queue
   * instead — at roughly thirty events per venue per day, queueing costs
   * nothing and forking would cost the log its meaning.
   */
  async append(orgId: string, ev: NewAuditEvent, opts: AppendOptions = {}): Promise<AppendResult> {
    await this.migrate();
    const ref = opts.clientRef ?? null;

    const result = await this.database.transaction((tx) =>
      withChainLock(tx, orgId, async () => {
        if (ref) {
          const existing = await tx.query<Row & { recorded_at: string }>(
            "SELECT * FROM audit_event WHERE org_id = $1 AND client_ref = $2",
            [orgId, ref],
          );
          if (existing.rows.length > 0) {
            const row = existing.rows[0];
            return { event: toEvent(row), recordedAt: row.recorded_at, created: false };
          }
        }

        const head = await tx.query<{ seq: string; hash: string }>(
          "SELECT seq, hash FROM chain_head WHERE org_id = $1",
          [orgId],
        );

        const tail: AuditEvent[] = [];
        if (head.rows.length > 0) {
          const tailRow = await tx.query<Row>(
            "SELECT * FROM audit_event WHERE org_id = $1 AND seq = $2",
            [orgId, head.rows[0].seq],
          );
          if (tailRow.rows.length > 0) tail.push(toEvent(tailRow.rows[0]));
        }

        const next = appendEvent(tail, ev).at(-1) as AuditEvent;
        const recordedAt = new Date().toISOString();

        await tx.query(
          `INSERT INTO audit_event
             (org_id, seq, id, type, at, recorded_at, actor, actor_did, subject, summary, data, prev_hash, hash, client_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [orgId, next.seq, next.id, next.type, next.at, recordedAt, next.actor,
           next.actorDid ?? null, next.subject ?? null, next.summary,
           JSON.stringify(next.data), next.prevHash, next.hash, ref],
        );

        await tx.query(
          `INSERT INTO chain_head (org_id, seq, hash) VALUES ($1,$2,$3)
             ON CONFLICT (org_id) DO UPDATE SET seq = EXCLUDED.seq, hash = EXCLUDED.hash`,
          [orgId, next.seq, next.hash],
        );

        return { event: next, recordedAt, created: true };
      }),
    );

    if (result.created) queueMicrotask(() => this.bus.emit("append", orgId, result.event));
    return result;
  }

  async since(orgId: string, seq: number): Promise<AuditEvent[]> {
    await this.migrate();
    const r = await this.database.query<Row>(
      "SELECT * FROM audit_event WHERE org_id = $1 AND seq > $2 ORDER BY seq",
      [orgId, seq],
    );
    return r.rows.map(toEvent);
  }

  async all(orgId: string): Promise<AuditEvent[]> {
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
  async byClientRef(orgId: string, clientRef: string): Promise<AuditEvent | null> {
    await this.migrate();
    const r = await this.database.query<Row>(
      "SELECT * FROM audit_event WHERE org_id = $1 AND client_ref = $2",
      [orgId, clientRef],
    );
    return r.rows.length > 0 ? toEvent(r.rows[0]) : null;
  }

  async head(orgId: string): Promise<{ seq: number; hash: string } | null> {
    await this.migrate();
    const r = await this.database.query<{ seq: string; hash: string }>(
      "SELECT seq, hash FROM chain_head WHERE org_id = $1",
      [orgId],
    );
    return r.rows.length > 0 ? { seq: Number(r.rows[0].seq), hash: r.rows[0].hash } : null;
  }

  async verify(orgId: string): Promise<{ ok: boolean; brokenAt: number | null }> {
    return verifyChain(await this.all(orgId));
  }

  async withMeta(orgId: string): Promise<EventMeta[]> {
    await this.migrate();
    const r = await this.database.query<Row>(
      "SELECT * FROM audit_event WHERE org_id = $1 ORDER BY seq",
      [orgId],
    );
    return r.rows.map((row) => ({ event: toEvent(row), recordedAt: row.recorded_at }));
  }

  /** Live appends, in this process. See the note at the top of the file. */
  subscribe(orgId: string, fn: (e: AuditEvent) => void): () => void {
    const handler = (org: string, e: AuditEvent) => {
      if (org === orgId) fn(e);
    };
    this.bus.on("append", handler);
    return () => this.bus.off("append", handler);
  }

  async seedIfEmpty(orgId: string, events: NewAuditEvent[]): Promise<number> {
    if (await this.head(orgId)) return 0;
    for (const ev of events) await this.append(orgId, ev);
    return events.length;
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}

const KEY = Symbol.for("covers.eventStore");
type Holder = { [KEY]?: Promise<EventStore> };

export function eventStore(): Promise<EventStore> {
  const g = globalThis as Holder;
  if (!g[KEY]) g[KEY] = db().then((d) => new EventStore(d));
  return g[KEY];
}
