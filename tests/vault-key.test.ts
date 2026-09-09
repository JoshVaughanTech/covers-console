/* ============================================================
   How the pack vault is keyed.

   There was no test here, and the gap had a bug in it. `masterKey()`
   read COVERS_PACK_KEY, base64-decoded it and took the first 32
   bytes — and every one of those steps is silent on bad input.
   `Buffer.from(x, "base64")` never throws; it drops what it cannot
   decode. `subarray` returns whatever it was handed. HKDF accepts
   any IKM length. So a typo'd or truncated key produced a few bytes
   of guessable entropy, every TFN and BSB in the vault was encrypted
   under it, and the app started and provisioned and reported success.

   The distinction these tests hold the module to is the one
   sinkFromEnv() already drew about sign-in codes: an unset variable
   says nobody asked, a bad value says somebody asked and got it
   wrong. Falling back to the safe default answers the second as
   though it were the first.

   Unset stays supported — ephemeral key, payloads die with the
   process — because that is what makes the demo work without
   putting a real key anywhere.
   ============================================================ */
import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { PackVault } from "../lib/idara/vault";

const KEY = "COVERS_PACK_KEY";
const before = process.env[KEY];

afterEach(() => {
  if (before === undefined) delete process.env[KEY];
  else process.env[KEY] = before;
});

const put = () => new PackVault().put("did:example:worker", "bank_account", { bsb: "063000" });

describe("a misconfigured key is refused", () => {
  /* The exact values that motivated the fix. Each decodes to something, none
     decodes to 32 bytes, and none of them threw before. */
  it.each([
    ["not valid base64 at all", "not-base64!!"],
    ["a four-character paste", "AAAA"],
    ["a short word, correctly encoded", "c2hvcnQ="],
    ["hex rather than base64", randomBytes(32).toString("hex")],
    ["one byte short", randomBytes(31).toString("base64")],
    ["one byte long", randomBytes(33).toString("base64")],
  ])("refuses %s", (_label, value) => {
    process.env[KEY] = value;
    expect(() => put()).toThrow(/COVERS_PACK_KEY/);
  });

  it("says what a good value looks like, because the caller has to produce one", () => {
    process.env[KEY] = "AAAA";
    expect(() => put()).toThrow(/randomBytes/);
  });

  /* Too long is as much a sign of the wrong value as too short. Taking the
     first 32 bytes of a longer one would key the vault off a misreading. */
  it("does not quietly truncate a longer key", () => {
    process.env[KEY] = randomBytes(64).toString("base64");
    expect(() => put()).toThrow(/exactly 32 bytes/);
  });
});

describe("a good key works, and an absent one is still supported", () => {
  it("accepts exactly 32 bytes of base64", () => {
    process.env[KEY] = randomBytes(32).toString("base64");
    const vault = new PackVault();
    const ref = vault.put("did:example:worker", "tfn_declaration", { tfn: "000 000 001" });
    expect(vault.release(ref, { engagementId: "eng-1", toConnector: "mock" })).toEqual({
      tfn: "000 000 001",
    });
  });

  it("falls back to an ephemeral key when nobody configured one", () => {
    delete process.env[KEY];
    const vault = new PackVault();
    const ref = vault.put("did:example:worker", "bank_account", { bsb: "063000" });
    expect(vault.release(ref, { engagementId: "eng-1", toConnector: "mock" })).toEqual({
      bsb: "063000",
    });
  });

  /* The property the whole design rests on: a payload written under one key
     cannot be read under another. Without it, "encrypted per worker" would be
     a claim rather than a mechanism. */
  it("cannot read a payload written under a different key", () => {
    process.env[KEY] = randomBytes(32).toString("base64");
    const vault = new PackVault();
    const ref = vault.put("did:example:worker", "bank_account", { bsb: "063000" });

    process.env[KEY] = randomBytes(32).toString("base64");
    expect(() => vault.release(ref, { engagementId: "eng-1", toConnector: "mock" })).toThrow();
  });
});
