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
import { EventStore } from "../lib/store/events";
import { appendEvent, verifyChain } from "../lib/idara/audit";
import { canonicalJson } from "../lib/idara/hash";
import { CONSOLE_OPERATOR } from "../lib/idara/seed";
import type { AuditEvent, NewAuditEvent } from "../lib/idara";
import { db, setDb, type Db } from "../lib/store/db";

const ORG = "org-test";
const AT = "2024-05-16";
let store: EventStore;

beforeEach(async () => {
  setDb(null);
  store = new EventStore(await db());
});
afterEach(async () => {
  await store.close();
  setDb(null);
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
  it("drops an undefined actorDid from the digest, and keeps a null one", async () => {
    // this is the whole hazard, stated as an assertion rather than a comment
    const withUndefined = canonicalJson({ actor: "A", actorDid: undefined });
    const withNull = canonicalJson({ actor: "A", actorDid: null });
    const withNothing = canonicalJson({ actor: "A" });

    expect(withUndefined).toBe(withNothing);
    expect(withNull).not.toBe(withNothing);
    expect(withNull).toContain("null");
  });

  it("means an absent actorDid hashes exactly as it did before the field existed", async () => {
    const before = appendEvent([], { ...oldStyle(1) });
    const after = appendEvent([], { ...oldStyle(1), actorDid: undefined });
    expect(after[0].hash).toBe(before[0].hash);
  });
});

describe("a chain written before the field, read back after it", () => {
  it("still verifies", async () => {
    for (let n = 0; n < 4; n++) (await store.append(ORG, oldStyle(n)));
    expect((await store.verify(ORG)).ok).toBe(true);
    expect(verifyChain((await store.all(ORG))).ok).toBe(true);
  });

  it("comes back with actorDid undefined, not null", async () => {
    (await store.append(ORG, oldStyle(0)));
    const [e] = (await store.all(ORG));
    expect(e.actorDid).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(e, "actorDid") && e.actorDid === null).toBe(false);
  });

  it("re-hashes to the same digest it was stored with", async () => {
    // the failure this catches: a field hashed on write and lost on persist
    (await store.append(ORG, oldStyle(0)));
    const [e] = (await store.all(ORG));
    expect(verifyChain([e]).ok).toBe(true);
  });
});

describe("a mixed chain — the case a fresh database cannot produce", () => {
  const mixed = async () => {
    await store.append(ORG, oldStyle(0));
    await store.append(ORG, oldStyle(1));
    await store.append(ORG, newStyle(2));
    await store.append(ORG, oldStyle(3)); // a system event after the migration
    await store.append(ORG, newStyle(4));
  };

  it("verifies end to end", async () => {
    await mixed();
    expect((await store.verify(ORG))).toEqual({ ok: true, brokenAt: null });
  });

  it("verifies again after a full read-back, which is what a reload does", async () => {
    await mixed();
    const rows = (await store.all(ORG));
    expect(rows).toHaveLength(5);
    expect(verifyChain(rows).ok).toBe(true);
  });

  it("keeps each event's own actor identity through the round trip", async () => {
    await mixed();
    const rows = (await store.all(ORG));
    expect(rows[0].actorDid).toBeUndefined();
    expect(rows[2].actorDid).toBe(CONSOLE_OPERATOR.did);
    expect(rows[3].actorDid).toBeUndefined();
    expect(rows[4].actorDid).toBe(CONSOLE_OPERATOR.did);
  });

  it("does not disturb the display name either way", async () => {
    await mixed();
    const rows = (await store.all(ORG));
    expect(rows[0].actor).toBe("Supervisor");
    expect(rows[2].actor).toBe(CONSOLE_OPERATOR.name);
  });
});

describe("a database that predates the column", () => {
  /** Build the audit_event table exactly as it was before actor_did. */
  const oldSchema = (d: Db) =>
    d.exec(`CREATE TABLE audit_event (
      org_id TEXT NOT NULL, seq BIGINT NOT NULL, id TEXT NOT NULL,
      type TEXT NOT NULL, at TEXT NOT NULL, recorded_at TEXT NOT NULL,
      actor TEXT NOT NULL, subject TEXT, summary TEXT NOT NULL, data JSONB NOT NULL,
      prev_hash TEXT NOT NULL, hash TEXT NOT NULL, client_ref TEXT,
      PRIMARY KEY (org_id, seq));
      CREATE TABLE chain_head (org_id TEXT PRIMARY KEY, seq BIGINT NOT NULL, hash TEXT NOT NULL);`);

  let aged: Db;
  beforeEach(async () => {
    setDb(null);
    aged = await db();
    await oldSchema(aged);
  });
  afterEach(async () => {
    await aged.close();
    setDb(null);
  });

  it("adds the column rather than failing every append", async () => {
    // CREATE TABLE IF NOT EXISTS does nothing to a table that exists, so
    // without a migration this store writes 14 values into 13 columns
    const s = new EventStore(aged);
    await expect(s.append(ORG, newStyle(0))).resolves.not.toThrow();
    expect((await s.all(ORG))[0].actorDid).toBe(CONSOLE_OPERATOR.did);
  });

  it("is safe to run again on an already-migrated database", async () => {
    const first = new EventStore(aged);
    await first.append(ORG, newStyle(0));
    // a second store over the same database, as a second instance would be
    const second = new EventStore(aged);
    await expect(second.append(ORG, newStyle(1))).resolves.not.toThrow();
    expect(await second.all(ORG)).toHaveLength(2);
  });

  it("leaves rows written before the migration verifying", async () => {
    // the migration must not disturb what is already chained
    const before = new EventStore(aged);
    await before.append(ORG, oldStyle(0));
    await before.append(ORG, oldStyle(1));

    const after = new EventStore(aged);
    await after.append(ORG, newStyle(2));
    expect(await after.verify(ORG)).toEqual({ ok: true, brokenAt: null });
    expect((await after.all(ORG))[0].actorDid).toBeUndefined();
  });
});

describe("what the field is for", () => {
  it("distinguishes two actors who share a name", async () => {
    const a: NewAuditEvent = { ...newStyle(0), actor: "Sam Taylor", actorDid: "did:web:idara.app:w:sam-taylor-1" };
    const b: NewAuditEvent = { ...newStyle(1), actor: "Sam Taylor", actorDid: "did:web:idara.app:w:sam-taylor-2" };
    (await store.append(ORG, a));
    (await store.append(ORG, b));
    const rows = (await store.all(ORG));
    expect(rows[0].actor).toBe(rows[1].actor);
    expect(rows[0].actorDid).not.toBe(rows[1].actorDid);
  });

  it("lets a decision be attributed without trusting the display name", async () => {
    (await store.append(ORG, newStyle(0)));
    const mine = (await store.all(ORG)).filter((e: AuditEvent) => e.actorDid === CONSOLE_OPERATOR.did);
    expect(mine).toHaveLength(1);
  });

  it("leaves system events without one, rather than inventing an identity", async () => {
    (await store.append(ORG, { type: "decision", at: AT, actor: "system", summary: "auto", data: {} }));
    expect((await store.all(ORG))[0].actorDid).toBeUndefined();
  });
});
