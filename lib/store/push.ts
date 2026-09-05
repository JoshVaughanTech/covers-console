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
import { db, type Db } from "./db";

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

export class PushStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly database: Db) {}

  private async migrate(): Promise<void> {
    if (!this.ready) this.ready = this.database.exec(DDL);
    return this.ready;
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
  async save(orgId: string, sub: PushSubscriptionRow, at: string): Promise<void> {
    await this.migrate();
    await this.database.query(
      `INSERT INTO push_subscription (org_id, did, endpoint, p256dh, auth, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id, endpoint) DO UPDATE SET
         did = EXCLUDED.did, p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth, created_at = EXCLUDED.created_at`,
      [orgId, sub.did, sub.endpoint, sub.p256dh, sub.auth, at],
    );
  }

  async forWorker(orgId: string, did: string): Promise<PushSubscriptionRow[]> {
    await this.migrate();
    const r = await this.database.query<PushSubscriptionRow>(
      "SELECT did, endpoint, p256dh, auth FROM push_subscription WHERE org_id = $1 AND did = $2",
      [orgId, did],
    );
    return r.rows;
  }

  /** Forget one device — on sign-out, or when the service says it is gone. */
  async remove(orgId: string, endpoint: string): Promise<boolean> {
    await this.migrate();
    const r = await this.database.query(
      "DELETE FROM push_subscription WHERE org_id = $1 AND endpoint = $2",
      [orgId, endpoint],
    );
    return r.rowCount > 0;
  }

  async countFor(orgId: string, did: string): Promise<number> {
    await this.migrate();
    const r = await this.database.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM push_subscription WHERE org_id = $1 AND did = $2",
      [orgId, did],
    );
    return Number(r.rows[0].n);
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}

const KEY = Symbol.for("covers.pushStore");
type Holder = { [KEY]?: Promise<PushStore> };

export function pushStore(): Promise<PushStore> {
  const g = globalThis as Holder;
  if (!g[KEY]) g[KEY] = db().then((d) => new PushStore(d));
  return g[KEY];
}
