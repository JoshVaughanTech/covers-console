/* ============================================================
   What each worker has been told, and whether they have seen it.

   Split across two homes on purpose, for the same reason sessions
   are not in the chain.

   That a shift was offered to somebody is a fact that never stops
   being true, and it is exactly what a dispute turns on — "I was
   never told about that shift" is answerable only if the offer was
   recorded when it happened. That goes in the audit chain, as one
   shift.offered event per posting carrying the audience.

   Whether they have read it is mutable, and belongs nowhere near an
   append-only log. It lives here.

   The row is per worker per posting rather than per event, so a
   posting that is offered twice — a seat reopening after a decline —
   updates one row instead of stacking duplicates on somebody's
   phone. The primary key enforces that rather than the caller
   remembering.
   ============================================================ */
import { db, type Db } from "./db";

const DDL = `
CREATE TABLE IF NOT EXISTS notification (
  org_id     TEXT NOT NULL,
  did        TEXT NOT NULL,
  posting_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  function_name TEXT NOT NULL,
  day        TEXT NOT NULL,
  -- not "window": that is a reserved word in Postgres, and a column needing
  -- quotes in every statement is a typo waiting to be made somewhere
  window_label TEXT NOT NULL,
  site_name  TEXT NOT NULL,
  offered_at TEXT NOT NULL,
  seen_at    TEXT,
  PRIMARY KEY (org_id, did, posting_id)
);

CREATE INDEX IF NOT EXISTS notification_unseen
  ON notification (org_id, did, seen_at);
`;

export interface Offer {
  postingId: string;
  role: string;
  functionName: string;
  day: string;
  window: string;
  siteName: string;
  offeredAt: string;
  seenAt: string | null;
}

type Row = {
  posting_id: string; role: string; function_name: string;
  day: string; window_label: string; site_name: string;
  offered_at: string; seen_at: string | null;
};

const toOffer = (r: Row): Offer => ({
  postingId: r.posting_id,
  role: r.role,
  functionName: r.function_name,
  day: r.day,
  window: r.window_label,
  siteName: r.site_name,
  offeredAt: r.offered_at,
  seenAt: r.seen_at,
});

export class NotificationStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly database: Db) {}

  private async migrate(): Promise<void> {
    if (!this.ready) this.ready = this.database.exec(DDL);
    return this.ready;
  }

  /**
   * Tell these people about this shift.
   *
   * Re-offering leaves a seen notification seen. Somebody who read about a
   * shift on Tuesday has not un-read it because a seat reopened on Thursday,
   * and marking it unread again would train people to ignore the badge.
   */
  async offer(
    orgId: string,
    dids: string[],
    shift: Omit<Offer, "offeredAt" | "seenAt">,
    at: string,
  ): Promise<number> {
    if (dids.length === 0) return 0;
    await this.migrate();

    let n = 0;
    for (const did of dids) {
      const r = await this.database.query(
        `INSERT INTO notification
           (org_id, did, posting_id, role, function_name, day, window_label, site_name, offered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (org_id, did, posting_id) DO NOTHING`,
        [orgId, did, shift.postingId, shift.role, shift.functionName,
         shift.day, shift.window, shift.siteName, at],
      );
      n += r.rowCount;
    }
    return n;
  }

  /** Everything this person has been told about, newest first. */
  async forWorker(orgId: string, did: string): Promise<Offer[]> {
    await this.migrate();
    const r = await this.database.query<Row>(
      "SELECT * FROM notification WHERE org_id = $1 AND did = $2 ORDER BY offered_at DESC, posting_id DESC",
      [orgId, did],
    );
    return r.rows.map(toOffer);
  }

  async unseenCount(orgId: string, did: string): Promise<number> {
    await this.migrate();
    const r = await this.database.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM notification WHERE org_id = $1 AND did = $2 AND seen_at IS NULL",
      [orgId, did],
    );
    return Number(r.rows[0].n);
  }

  /**
   * Mark as seen.
   *
   * Scoped to the person doing the marking, always. A route that let a caller
   * name whose notifications to clear would be a way to hide a shift from
   * somebody, and the badge is the only thing that would have told them.
   */
  async markSeen(orgId: string, did: string, at: string, postingIds?: string[]): Promise<number> {
    if (postingIds && postingIds.length === 0) return 0;
    await this.migrate();

    if (!postingIds) {
      const r = await this.database.query(
        "UPDATE notification SET seen_at = $1 WHERE org_id = $2 AND did = $3 AND seen_at IS NULL",
        [at, orgId, did],
      );
      return r.rowCount;
    }

    /* = ANY($4) rather than an IN list built by hand. A generated list of
       placeholders is where an off-by-one puts somebody else's posting id in
       somebody's WHERE clause. */
    const r = await this.database.query(
      `UPDATE notification SET seen_at = $1
        WHERE org_id = $2 AND did = $3 AND seen_at IS NULL AND posting_id = ANY($4)`,
      [at, orgId, did, postingIds],
    );
    return r.rowCount;
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}

const KEY = Symbol.for("covers.notificationStore");
type Holder = { [KEY]?: Promise<NotificationStore> };

export function notificationStore(): Promise<NotificationStore> {
  const g = globalThis as Holder;
  if (!g[KEY]) g[KEY] = db().then((d) => new NotificationStore(d));
  return g[KEY];
}
