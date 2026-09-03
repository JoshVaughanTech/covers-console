/* ============================================================
   Who did it.

   AuditEvent.subject was a DID and AuditEvent.actor was a display
   name, so the chain answered "who was this about" precisely and
   "who did this" only loosely. Two people called Sam Taylor were
   indistinguishable in a compliance log, and a display name is not
   stable across a rename.

   Adding a field to a hashed, append-only record is the dangerous
   kind of migration, and the danger is not the obvious one. The
   digest covers Omit<AuditEvent, "hash">, and canonicalJson drops
   keys whose value is `undefined` while keeping keys whose value is
   `null`. So an absent actorDid must arrive back from storage as
   undefined. If a NULL column maps to null instead, every event
   written before this field existed re-hashes differently and the
   whole chain reads as tampered.

   Both spellings compile. Both look right. These tests are what
   separates them.
   ============================================================ */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { EventStore } from "../lib/store/events";
import { appendEvent, verifyChain } from "../lib/idara/audit";
import { canonicalJson } from "../lib/idara/hash";
import { CONSOLE_OPERATOR } from "../lib/idara/seed";
import type { AuditEvent, NewAuditEvent } from "../lib/idara";

const ORG = "org-test";
const AT = "2024-05-16";
let store: EventStore;

beforeEach(() => {
  store = new EventStore(":memory:");
});
afterEach(() => {
  store.close();
});

/** An event as written before actorDid existed. */
const oldStyle = (n: number): NewAuditEvent => ({
  type: "decision",
  at: AT,
  actor: "Supervisor",
  subject: "did:web:idara.app:w:darie-roberts",
  summary: `pre-migration event ${n}`,
  data: { n },
});

/** An event written since. */
const newStyle = (n: number): NewAuditEvent => ({
  type: "shift.assigned",
  at: AT,
  actor: CONSOLE_OPERATOR.name,
  actorDid: CONSOLE_OPERATOR.did,
  subject: "did:web:idara.app:w:mitch-egan",
  summary: `post-migration event ${n}`,
  data: { n },
});

describe("the null trap", () => {
  it("drops an undefined actorDid from the digest, and keeps a null one", () => {
    // this is the whole hazard, stated as an assertion rather than a comment
    const withUndefined = canonicalJson({ actor: "A", actorDid: undefined });
    const withNull = canonicalJson({ actor: "A", actorDid: null });
    const withNothing = canonicalJson({ actor: "A" });

    expect(withUndefined).toBe(withNothing);
    expect(withNull).not.toBe(withNothing);
    expect(withNull).toContain("null");
  });

  it("means an absent actorDid hashes exactly as it did before the field existed", () => {
    const before = appendEvent([], { ...oldStyle(1) });
    const after = appendEvent([], { ...oldStyle(1), actorDid: undefined });
    expect(after[0].hash).toBe(before[0].hash);
  });
});

describe("a chain written before the field, read back after it", () => {
  it("still verifies", () => {
    for (let n = 0; n < 4; n++) store.append(ORG, oldStyle(n));
    expect(store.verify(ORG).ok).toBe(true);
    expect(verifyChain(store.all(ORG)).ok).toBe(true);
  });

  it("comes back with actorDid undefined, not null", () => {
    store.append(ORG, oldStyle(0));
    const [e] = store.all(ORG);
    expect(e.actorDid).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(e, "actorDid") && e.actorDid === null).toBe(false);
  });

  it("re-hashes to the same digest it was stored with", () => {
    // the failure this catches: a field hashed on write and lost on persist
    store.append(ORG, oldStyle(0));
    const [e] = store.all(ORG);
    expect(verifyChain([e]).ok).toBe(true);
  });
});

describe("a mixed chain — the case a fresh database cannot produce", () => {
  const mixed = () => {
    store.append(ORG, oldStyle(0));
    store.append(ORG, oldStyle(1));
    store.append(ORG, newStyle(2));
    store.append(ORG, oldStyle(3)); // a system event after the migration
    store.append(ORG, newStyle(4));
  };

  it("verifies end to end", () => {
    mixed();
    expect(store.verify(ORG)).toEqual({ ok: true, brokenAt: null });
  });

  it("verifies again after a full read-back, which is what a reload does", () => {
    mixed();
    const rows = store.all(ORG);
    expect(rows).toHaveLength(5);
    expect(verifyChain(rows).ok).toBe(true);
  });

  it("keeps each event's own actor identity through the round trip", () => {
    mixed();
    const rows = store.all(ORG);
    expect(rows[0].actorDid).toBeUndefined();
    expect(rows[2].actorDid).toBe(CONSOLE_OPERATOR.did);
    expect(rows[3].actorDid).toBeUndefined();
    expect(rows[4].actorDid).toBe(CONSOLE_OPERATOR.did);
  });

  it("does not disturb the display name either way", () => {
    mixed();
    const rows = store.all(ORG);
    expect(rows[0].actor).toBe("Supervisor");
    expect(rows[2].actor).toBe(CONSOLE_OPERATOR.name);
  });
});

describe("a database that predates the column", () => {
  /** Build the audit_event table exactly as it was before actor_did. */
  const oldSchema = (db: DatabaseSync) =>
    db.exec(`CREATE TABLE audit_event (
      org_id TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL,
      type TEXT NOT NULL, at TEXT NOT NULL, recorded_at TEXT NOT NULL,
      actor TEXT NOT NULL, subject TEXT, summary TEXT NOT NULL, data TEXT NOT NULL,
      prev_hash TEXT NOT NULL, hash TEXT NOT NULL, client_ref TEXT,
      PRIMARY KEY (org_id, seq));
      CREATE TABLE chain_head (org_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, hash TEXT NOT NULL);`);

  let file: string;
  beforeEach(() => {
    file = join(tmpdir(), `covers-migrate-${randomUUID()}.db`);
    const seedDb = new DatabaseSync(file);
    oldSchema(seedDb);
    seedDb.close();
  });
  afterEach(() => {
    rmSync(file, { force: true });
  });

  it("adds the column rather than failing every append", () => {
    // CREATE TABLE IF NOT EXISTS does nothing to a table that exists, so
    // without a migration this store writes 14 values into 13 columns
    const s = new EventStore(file);
    expect(() => s.append(ORG, newStyle(0))).not.toThrow();
    expect(s.all(ORG)[0].actorDid).toBe(CONSOLE_OPERATOR.did);
    s.close();
  });

  it("is safe to run again on an already-migrated database", () => {
    const first = new EventStore(file);
    first.append(ORG, newStyle(0));
    first.close();
    const second = new EventStore(file);
    expect(() => second.append(ORG, newStyle(1))).not.toThrow();
    expect(second.all(ORG)).toHaveLength(2);
    second.close();
  });

  it("leaves rows written before the migration verifying", () => {
    // the migration must not disturb what is already chained
    const before = new EventStore(file);
    before.append(ORG, oldStyle(0));
    before.append(ORG, oldStyle(1));
    before.close();

    const after = new EventStore(file);
    after.append(ORG, newStyle(2));
    expect(after.verify(ORG)).toEqual({ ok: true, brokenAt: null });
    expect(after.all(ORG)[0].actorDid).toBeUndefined();
    after.close();
  });
});

describe("what the field is for", () => {
  it("distinguishes two actors who share a name", () => {
    const a: NewAuditEvent = { ...newStyle(0), actor: "Sam Taylor", actorDid: "did:web:idara.app:w:sam-taylor-1" };
    const b: NewAuditEvent = { ...newStyle(1), actor: "Sam Taylor", actorDid: "did:web:idara.app:w:sam-taylor-2" };
    store.append(ORG, a);
    store.append(ORG, b);
    const rows = store.all(ORG);
    expect(rows[0].actor).toBe(rows[1].actor);
    expect(rows[0].actorDid).not.toBe(rows[1].actorDid);
  });

  it("lets a decision be attributed without trusting the display name", () => {
    store.append(ORG, newStyle(0));
    const mine = store.all(ORG).filter((e: AuditEvent) => e.actorDid === CONSOLE_OPERATOR.did);
    expect(mine).toHaveLength(1);
  });

  it("leaves system events without one, rather than inventing an identity", () => {
    store.append(ORG, { type: "decision", at: AT, actor: "system", summary: "auto", data: {} });
    expect(store.all(ORG)[0].actorDid).toBeUndefined();
  });
});
