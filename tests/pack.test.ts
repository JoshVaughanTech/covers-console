/* ============================================================
   The pack.

   Two properties are worth a test suite of their own, because both
   fail silently and both fail badly.

   SENSITIVITY IS NOT AUTHORED. A TFN marked `public` by a bug would
   be readable by any venue the worker applied to, and the row would
   look completely normal. The tests below hold packItem() to
   stamping it from the taxonomy and refusing a restricted payload
   with nowhere encrypted to put it.

   COMPLETENESS IS COMPUTED. A stored flag and a lapsed right-to-work
   check disagree, and the flag is the one the marketplace reads. So
   the same pack is asked twice on two dates and must answer
   differently.
   ============================================================ */
import { describe, it, expect } from "vitest";
import {
  PACK_ITEMS,
  PACK_ITEM_META,
  REQUIRED_KINDS,
  RESTRICTED_KINDS,
  agreementCompatible,
  claimsThresholdWith,
  completenessOf,
  hashPackPayload,
  itemOf,
  packItem,
  packSnapshot,
  stateOf,
  thresholdNotice,
  type WorkerPack,
} from "../lib/idara/pack";
import { buildPacks, OTHER_EMPLOYER_DID } from "../lib/idara/pack-seed";
import { PackVault } from "../lib/idara/vault";
import { BRIGHTWATER_DID } from "../lib/idara/employer-seed";
import { WORKERS } from "../lib/idara/seed";

const AT = "2024-05-16";

const vault = new PackVault();
const packs = buildPacks(vault);
const packOf = (name: string) => packs.get(WORKERS.find((w) => w.name === name)!.did)!;

describe("sensitivity is a property of the kind", () => {
  it("stamps it from the taxonomy rather than taking it from the caller", () => {
    const item = packItem({
      kind: "tfn_declaration",
      issuer: "did:example:worker",
      verifiedAt: AT,
      payload: { tfn: "000 000 001" },
      payloadRef: "vault:test",
    });
    expect(item.sensitivity).toBe("restricted");
  });

  it("refuses a restricted item with no vault pointer", () => {
    expect(() =>
      packItem({
        kind: "bank_account",
        issuer: "did:example:worker",
        verifiedAt: AT,
        payload: { bsb: "063000", accountNumber: "10045000" },
      }),
    ).toThrow(/vault/i);
  });

  it("keeps no inline copy of a restricted payload", () => {
    const item = packItem({
      kind: "bank_account",
      issuer: "did:example:worker",
      verifiedAt: AT,
      payload: { bsb: "063000", accountNumber: "10045000" },
      payloadRef: "vault:test",
    });
    expect(item.payload).toBeUndefined();
    // the hash still commits to it, which is the only thing that should survive
    expect(item.hash).toBe(hashPackPayload("bank_account", { bsb: "063000", accountNumber: "10045000" }));
  });

  it("holds no restricted payload in clear anywhere in a seeded pack", () => {
    for (const worker of WORKERS) {
      const pack = packs.get(worker.did)!;
      for (const item of pack.items) {
        if (RESTRICTED_KINDS.includes(item.kind)) {
          expect(item.payload, `${worker.name} / ${item.kind}`).toBeUndefined();
          expect(item.payloadRef, `${worker.name} / ${item.kind}`).toBeTruthy();
        }
      }
    }
  });

  it("hashes the kind alongside the payload, so two kinds cannot collide", () => {
    const payload = { name: "Sam Okafor", phone: "+61412000000" };
    expect(hashPackPayload("emergency_contact", payload)).not.toBe(
      hashPackPayload("identity", payload),
    );
  });
});

describe("completeness", () => {
  it("is met by a full pack", () => {
    const c = completenessOf(packOf("Darie Roberts"), AT);
    expect(c.ok).toBe(true);
    expect(c.missing).toEqual([]);
    expect(c.progress).toBe(1);
  });

  it("names what is short, in the order the screen asks for it", () => {
    const c = completenessOf(packOf("Liam O'Brien"), AT);
    expect(c.ok).toBe(false);
    expect(c.missing).toEqual(["tfn_declaration", "super_choice"]);
    expect(c.progress).toBeLessThan(1);
  });

  /* The property a stored flag cannot have: the same pack, two dates, two
     answers. Jake's right-to-work check lapsed on 30 April. */
  it("counts a lapsed item as missing, and does so only after it lapses", () => {
    const jake = packOf("Jake Morrison");
    expect(completenessOf(jake, "2024-04-29").ok).toBe(true);
    const after = completenessOf(jake, "2024-05-01");
    expect(after.ok).toBe(false);
    expect(after.missing).toEqual(["right_to_work"]);
  });

  it("treats the expiry day itself as still valid", () => {
    const jake = packOf("Jake Morrison");
    // the day it expires is a day it is held; blocking somebody a day early
    // costs them a shift they were entitled to work
    expect(completenessOf(jake, "2024-04-30").ok).toBe(true);
  });

  it("ignores a revoked item even when it has not expired", () => {
    const base = packOf("Darie Roberts");
    const revoked: WorkerPack = {
      ...base,
      items: base.items.map((i) =>
        i.kind === "identity" ? { ...i, status: "revoked" as const } : i,
      ),
    };
    expect(completenessOf(revoked, AT).missing).toEqual(["identity"]);
  });

  it("does not require a credential item — that is the engine's question", () => {
    expect(REQUIRED_KINDS).not.toContain("credential");
    expect(PACK_ITEM_META.credential.required).toBe(false);
  });

  it("warns before it refuses", () => {
    const jake = packOf("Jake Morrison");
    // 15 days out: still complete, and already saying so
    const c = completenessOf(jake, "2024-04-15");
    expect(c.ok).toBe(true);
    expect(c.expiringSoon.map((e) => e.kind)).toContain("right_to_work");
  });
});

describe("the tax-free threshold", () => {
  it("is claimed with the nominated employer and nowhere else", () => {
    const darie = packOf("Darie Roberts");
    expect(claimsThresholdWith(darie, BRIGHTWATER_DID)).toBe(true);
    expect(claimsThresholdWith(darie, OTHER_EMPLOYER_DID)).toBe(false);
  });

  it("is not claimed anywhere when nobody has been nominated", () => {
    const aaron = packOf("Aaron Patel");
    expect(aaron.primaryEmployerDid).toBeUndefined();
    expect(claimsThresholdWith(aaron, BRIGHTWATER_DID)).toBe(false);
  });

  /* The warning is the feature. Withholding a little too much is refundable;
     claiming twice is a bill, and the person it lands on is a casual with two
     jobs who was never told. */
  it("warns when the threshold sits with somebody else", () => {
    const leanne = packOf("Leanne Vidal");
    expect(thresholdNotice(leanne, BRIGHTWATER_DID, "Brightwater")).toMatch(/another employer/i);
    expect(thresholdNotice(leanne, OTHER_EMPLOYER_DID, "Portside")).toBeNull();
  });

  it("warns when it has not been nominated at all", () => {
    expect(thresholdNotice(packOf("Aaron Patel"), BRIGHTWATER_DID, "Brightwater")).toMatch(
      /haven't chosen/i,
    );
  });
});

describe("agreement versions", () => {
  it("matches exactly and refuses to guess compatibility", () => {
    expect(agreementCompatible("casual-higa-v1", "casual-higa-v1")).toBe(true);
    expect(agreementCompatible("casual-higa-v1", "casual-higa-v2")).toBe(false);
  });
});

describe("the snapshot an engagement pins", () => {
  it("carries a hash for every valid item and nothing for the missing ones", () => {
    const snapshot = packSnapshot(packOf("Liam O'Brien"), AT);
    expect(snapshot.tfn_declaration).toBeUndefined();
    expect(snapshot.identity).toBe(itemOf(packOf("Liam O'Brien"), "identity")!.hash);
  });

  it("drops an item that has lapsed, so a signature cannot pin a stale check", () => {
    const jake = packOf("Jake Morrison");
    expect(packSnapshot(jake, "2024-04-01").right_to_work).toBeTruthy();
    expect(packSnapshot(jake, "2024-05-16").right_to_work).toBeUndefined();
  });
});

describe("the taxonomy itself", () => {
  it("gives every kind a meta entry and a stable order", () => {
    for (const meta of PACK_ITEMS) {
      expect(PACK_ITEM_META[meta.kind]).toBe(meta);
    }
  });

  it("keeps the five payroll-only kinds restricted", () => {
    expect([...RESTRICTED_KINDS].sort()).toEqual(
      ["bank_account", "emergency_contact", "identity", "super_choice", "tfn_declaration"].sort(),
    );
  });

  it("reports an item's state without mutating it", () => {
    const item = itemOf(packOf("Jake Morrison"), "right_to_work")!;
    expect(stateOf(item, "2024-05-16")).toBe("expired");
    expect(item.status).toBe("valid");
  });
});
