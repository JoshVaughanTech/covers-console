/* ============================================================
   Idara — the encrypted half of the pack.

   pack.ts holds hashes, kinds and validity: everything you can show
   a person without showing them anything. This holds the bytes —
   the TFN, the BSB, the KYC result — and it is deliberately a
   separate module with a separate rule.

   THE RULE: a payload is decrypted inside provision() and nowhere
   else. Not on a screen, not in a log line, not in an analytics
   event, not in an error message. A TFN table is the single worst
   thing this product could have breached, so the design is that
   there isn't one: per-worker keys, ciphertext at rest, and one
   caller allowed to ask.

   Why this is not exported from "@/lib/idara": the barrel is
   imported by client components, and node:crypto is not something
   that should even be reachable from a browser bundle. board.ts
   already imports the seed directly for the same reason. Server
   code imports this file by path, which is a small friction that
   makes "who can decrypt a TFN" answerable with grep.

   AES-256-GCM, per-worker key derived with HKDF from a master key.
   GCM rather than CBC because the tag makes tampering a failure
   rather than a plausible plaintext, and per-worker rather than
   per-org because destroying one worker's key destroys one worker's
   payloads — which is what "tombstone the pack, keep the hash" in
   §10 of the design actually requires of the storage layer.
   ============================================================ */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import type { PackItemKind } from "./pack";
import type { DID } from "./types";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

/**
 * The master key every per-worker key is derived from.
 *
 * A random key when none is configured, and the consequence is stated rather
 * than hidden: payloads written this process cannot be read by the next one.
 * For a demo that is correct — the vault is in memory too, so both halves die
 * together and there is no window where ciphertext outlives its key and looks
 * like corruption.
 *
 * A deployment sets COVERS_PACK_KEY. If it does not, nobody's TFN is at risk;
 * they simply cannot be provisioned after a restart, which is the loud
 * failure rather than the quiet one.
 */
function masterKey(): Buffer {
  const configured = process.env.COVERS_PACK_KEY;
  if (configured) return Buffer.from(configured, "base64").subarray(0, KEY_LENGTH);
  return EPHEMERAL_KEY;
}

const EPHEMERAL_KEY = randomBytes(KEY_LENGTH);

/**
 * One worker, one key.
 *
 * The DID is the salt rather than the info parameter so that two workers can
 * never derive the same key even if the info string is ever changed or
 * forgotten — salt separation is the property being bought here.
 */
function keyFor(did: DID): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.from(did, "utf8"), "covers-pack", KEY_LENGTH));
}

interface VaultRow {
  did: DID;
  kind: PackItemKind;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

/**
 * Why a payload is being decrypted, stated at the call site.
 *
 * Not logging, not enforcement — a required argument. A caller that cannot
 * name an engagement and a connector is a caller with no business decrypting
 * anything, and making them say so turns "decrypt only in provision()" from a
 * comment into something the type checker asks about.
 */
export interface ReleaseContext {
  engagementId: string;
  toConnector: string;
}

export class PackVault {
  private rows = new Map<string, VaultRow>();

  /** Encrypt a payload and return the pointer a PackItem carries. */
  put(did: DID, kind: PackItemKind, payload: Record<string, unknown>): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, keyFor(did), iv);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
      cipher.final(),
    ]);
    const ref = `vault:${randomUUID()}`;
    this.rows.set(ref, { did, kind, iv, tag: cipher.getAuthTag(), ciphertext });
    return ref;
  }

  has(ref: string): boolean {
    return this.rows.has(ref);
  }

  /**
   * Decrypt one payload for one engagement.
   *
   * Throws rather than returning null on a missing ref, and the difference
   * matters at the call site: provisioning that silently skipped an
   * unreadable TFN would create an employee with no declaration lodged and
   * report success. A throw stops the engagement short of `provisioned`,
   * which is the state that says payroll has what it needs.
   */
  release(ref: string, context: ReleaseContext): Record<string, unknown> {
    const row = this.rows.get(ref);
    if (!row) {
      // the context is in the message because this failure is read by somebody
      // trying to work out why one engagement would not provision
      throw new Error(
        `No vault payload at ${ref} (engagement ${context.engagementId} → ${context.toConnector})`,
      );
    }

    const decipher = createDecipheriv(ALGORITHM, keyFor(row.did), row.iv);
    decipher.setAuthTag(row.tag);
    const plain = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as Record<string, unknown>;
  }

  /**
   * Destroy every payload for one worker.
   *
   * The deletion story from §10: the hash stays on the chain, so an audit of a
   * past engagement still verifies, and the payload behind it is gone. What is
   * left is a record that something was true and no way to read what it was,
   * which is the correct end state for a person who has left.
   */
  destroy(did: DID): number {
    let n = 0;
    for (const [ref, row] of this.rows) {
      if (row.did === did) {
        this.rows.delete(ref);
        n++;
      }
    }
    return n;
  }

  /** How many payloads are held, for a health check. Never what they are. */
  get size(): number {
    return this.rows.size;
  }
}

/* One vault per process, cached on globalThis so Next's dev-mode module
   reloads do not orphan the packs seeded into it — the same pattern the
   event store uses, and for the same reason. */
const KEY = Symbol.for("covers.packVault");
type Holder = { [KEY]?: PackVault };

export function packVault(): PackVault {
  const g = globalThis as unknown as Holder;
  return (g[KEY] ??= new PackVault());
}
