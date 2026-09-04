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
   phone. The unique index enforces that rather than the caller
   remembering.
   ============================================================ */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DDL = `
CREATE TABLE IF NOT EXISTS notification (
  org_id     TEXT    NOT NULL,
  did        TEXT    NOT NULL,
  posting_id TEXT    NOT NULL,
  role       TEXT    NOT NULL,
  function_name TEXT NOT NULL,
  day        TEXT    NOT NULL,
  window     TEXT    NOT NULL,
  site_name  TEXT    NOT NULL,
  offered_at TEXT    NOT NULL,
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
  day: string; window: string; site_name: string;
  offered_at: string; seen_at: string | null;
};

const toOffer = (r: Row): Offer => ({
  postingId: r.posting_id,
  role: r.role,
  functionName: r.function_name,
  day: r.day,
  window: r.window,
  siteName: r.site_name,
  offeredAt: r.offered_at,
  seenAt: r.seen_at,
});

export class NotificationStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    // three connections open this file now; see the note in lib/store/auth.ts
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(DDL);
  }

  /**
   * Tell these people about this shift.
   *
   * Re-offering leaves a seen notification seen. Somebody who read about a
   * shift on Tuesday has not un-read it because a seat reopened on Thursday,
   * and marking it unread again would train people to ignore the badge.
   */
  offer(orgId: string, dids: string[], shift: Omit<Offer, "offeredAt" | "seenAt">, at: string): number {
    if (dids.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT INTO notification
         (org_id, did, posting_id, role, function_name, day, window, site_name, offered_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT (org_id, did, posting_id) DO NOTHING`,
    );
    let n = 0;
    for (const did of dids) {
      n += stmt.run(orgId, did, shift.postingId, shift.role, shift.functionName,
                    shift.day, shift.window, shift.siteName, at).changes as number;
    }
    return n;
  }

  /** Everything this person has been told about, newest first. */
  forWorker(orgId: string, did: string): Offer[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM notification WHERE org_id = ? AND did = ? ORDER BY offered_at DESC, posting_id DESC",
        )
        .all(orgId, did) as Row[]
    ).map(toOffer);
  }

  unseenCount(orgId: string, did: string): number {
    const { n } = this.db
      .prepare("SELECT COUNT(*) AS n FROM notification WHERE org_id = ? AND did = ? AND seen_at IS NULL")
      .get(orgId, did) as { n: number };
    return n;
  }

  /**
   * Mark as seen.
   *
   * Scoped to the person doing the marking, always. A route that let a caller
   * name whose notifications to clear would be a way to hide a shift from
   * somebody, and the badge is the only thing that would have told them.
   */
  markSeen(orgId: string, did: string, at: string, postingIds?: string[]): number {
    if (postingIds && postingIds.length === 0) return 0;
    if (!postingIds) {
      return this.db
        .prepare("UPDATE notification SET seen_at = ? WHERE org_id = ? AND did = ? AND seen_at IS NULL")
        .run(at, orgId, did).changes as number;
    }
    const holes = postingIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `UPDATE notification SET seen_at = ?
          WHERE org_id = ? AND did = ? AND seen_at IS NULL AND posting_id IN (${holes})`,
      )
      .run(at, orgId, did, ...postingIds).changes as number;
  }

  close(): void {
    this.db.close();
  }
}

const KEY = Symbol.for("covers.notificationStore");
type Holder = { [KEY]?: NotificationStore };

export function notificationStore(): NotificationStore {
  const g = globalThis as Holder;
  if (!g[KEY]) g[KEY] = new NotificationStore(process.env.COVERS_DB ?? ".data/covers.db");
  return g[KEY];
}
