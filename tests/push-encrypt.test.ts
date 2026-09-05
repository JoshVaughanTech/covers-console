import { describe, it, expect } from "vitest";
import { encryptPayload } from "../lib/push/encrypt";

/* ============================================================
   RFC 8291 §5, reproduced.

   This is the test that decides whether the push implementation is
   real. Hand-rolled crypto that "seems to work" is the worst kind:
   a wrong key derivation still produces bytes, the push service
   still accepts them with a 201, and the failure is a notification
   that never appears on a phone nobody is watching.

   The spec publishes a worked example with every input fixed — the
   receiver's keys, the auth secret, the sender's private key, the
   salt — and the exact expected output. Reproducing it byte for
   byte is the only claim worth making about this code, and it is
   the reason implementing the RFC directly is defensible here at
   all rather than reaching for a package.

   If this fails, the implementation is wrong. No amount of "the
   notification arrived in testing" should be allowed to override
   it, because a push service returning 201 says nothing about
   whether a browser could decrypt what it forwarded.
   ============================================================ */

/* Values verbatim from RFC 8291 §5. */
const PLAINTEXT = "When I grow up, I want to be a watermelon";

const RECEIVER_PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";

const SENDER_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const SALT = "DGv6ra1nlYgDCS1FRnbzlw";

/** The complete message body the RFC says this must produce. */
const EXPECTED =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
  "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
  "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

describe("RFC 8291 §5", () => {
  it("produces the exact ciphertext the spec publishes", async () => {
    const { body, encoding } = encryptPayload(
      PLAINTEXT,
      { p256dh: RECEIVER_PUBLIC, auth: AUTH_SECRET },
      {
        salt: Buffer.from(SALT, "base64url"),
        senderPrivate: Buffer.from(SENDER_PRIVATE, "base64url"),
      },
    );

    expect(encoding).toBe("aes128gcm");
    // byte for byte, including the header block and the GCM tag
    expect(body.toString("base64url")).toBe(EXPECTED);
  });

  it("puts the header the receiver needs where the spec says", async () => {
    const { body } = encryptPayload(
      PLAINTEXT,
      { p256dh: RECEIVER_PUBLIC, auth: AUTH_SECRET },
      {
        salt: Buffer.from(SALT, "base64url"),
        senderPrivate: Buffer.from(SENDER_PRIVATE, "base64url"),
      },
    );

    expect(body.subarray(0, 16).toString("base64url")).toBe(SALT);
    /* Record size is the size records are SPLIT at, not the length of this
       one. My first version of this assertion said the payload length, which
       is the same misreading that was in the implementation — so it would
       have agreed with the bug rather than catching it. The vector above is
       what caught both. */
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body[20]).toBe(65);
  });
});

describe("what must never repeat", () => {
  it("uses a fresh salt and a fresh keypair each time", async () => {
    const sub = { p256dh: RECEIVER_PUBLIC, auth: AUTH_SECRET };
    const a = encryptPayload(PLAINTEXT, sub).body;
    const b = encryptPayload(PLAINTEXT, sub).body;

    /* Same plaintext, same subscriber, different bytes. A reused salt with the
       same keys repeats the nonce, which takes GCM from secure to broken —
       and it is the failure most likely to be introduced by somebody
       "optimising" the key generation out of the hot path. */
    expect(a.toString("base64url")).not.toBe(b.toString("base64url"));
    expect(a.subarray(0, 16).toString("hex")).not.toBe(b.subarray(0, 16).toString("hex"));
    expect(a.subarray(21, 86).toString("hex")).not.toBe(b.subarray(21, 86).toString("hex"));
  });
});

describe("a subscription that is not one", () => {
  it("refuses a key of the wrong length rather than producing garbage", async () => {
    // a truncated or url-decoded-wrongly p256dh would otherwise encrypt to
    // something no browser can read, and the push service would still say 201
    expect(() =>
      encryptPayload(PLAINTEXT, { p256dh: Buffer.alloc(32).toString("base64url"), auth: AUTH_SECRET }),
    ).toThrow(/65 bytes/);
  });
});
