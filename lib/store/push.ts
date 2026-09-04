/* ============================================================
   Push subscriptions — one row per device, not per person.

   A worker with a phone and a tablet gets two, and both should
   fire. Keyed on the endpoint because that is what the browser
   guarantees unique; the same device re-subscribing after a
   permission reset produces a new endpoint and the old one starts
   returning 410, which is how dead rows are found rather than
   guessed at.

   Not in the audit chain, for the same reason sessions are not: a
   subscription is revocable and a dead one must be deletable. What
   IS worth recording — that somebody was told about a shift — is
   already in the chain as shift.offered, and it belongs to the
   offer rather than to the transport that carried it.
   ============================================================ */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DDL = `
CREATE TABLE IF NOT EXISTS push_subscription (
  org_id     TEXT NOT NULL,
  did        TEXT NOT NULL,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscription_did ON push_subscription (org_id, did);
`;

export interface PushSubscriptionRow {
  did: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

type Row = { did: string; endpoint: string; p256dh: string; auth: string };

export class PushStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(DDL);
  }

  /**
   * Remember a device.
   *
   * Re-subscribing replaces the keys rather than adding a row: a browser may
   * hand back the same endpoint with rotated keys, and keeping the old ones
   * would mean encrypting to something the device can no longer read — a push
   * that succeeds and silently never appears.
   *
   * The did is overwritten too, which matters on a shared device: a phone
   * signed out and signed back in as somebody else must stop receiving the
   * first person's shifts.
   */
  save(orgId: string, sub: PushSubscriptionRow, at: string): void {
    this.db
      .prepare(
        `INSERT INTO push_subscription (org_id, did, endpoint, p256dh, auth, created_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (org_id, endpoint) DO UPDATE SET
           did = excluded.did, p256dh = excluded.p256dh,
           auth = excluded.auth, created_at = excluded.created_at`,
      )
      .run(orgId, sub.did, sub.endpoint, sub.p256dh, sub.auth, at);
  }

  forWorker(orgId: string, did: string): PushSubscriptionRow[] {
    return this.db
      .prepare("SELECT did, endpoint, p256dh, auth FROM push_subscription WHERE org_id = ? AND did = ?")
      .all(orgId, did) as Row[];
  }

  /** Forget one device — on sign-out, or when the service says it is gone. */
  remove(orgId: string, endpoint: string): boolean {
    return (
      (this.db
        .prepare("DELETE FROM push_subscription WHERE org_id = ? AND endpoint = ?")
        .run(orgId, endpoint).changes as number) > 0
    );
  }

  countFor(orgId: string, did: string): number {
    const { n } = this.db
      .prepare("SELECT COUNT(*) AS n FROM push_subscription WHERE org_id = ? AND did = ?")
      .get(orgId, did) as { n: number };
    return n;
  }

  close(): void {
    this.db.close();
  }
}

const KEY = Symbol.for("covers.pushStore");
type Holder = { [KEY]?: PushStore };

export function pushStore(): PushStore {
  const g = globalThis as Holder;
  if (!g[KEY]) g[KEY] = new PushStore(process.env.COVERS_DB ?? ".data/covers.db");
  return g[KEY];
}
