import { describe, it, expect } from "vitest";
import { createVerify, createPublicKey } from "node:crypto";
import { generateVapidKeys, vapidHeader, publicJwkFrom, derToRaw } from "../lib/push/vapid";

/* ============================================================
   VAPID, checked by verifying rather than by inspecting.

   A signature that looks right and does not verify is the same
   class as the record-size bug next door: the push service answers
   401, which reads like an outage rather than a malformed token.
   So these reconstruct the public key and actually verify the JWS,
   which is the only assertion that means anything.
   ============================================================ */

const keys = generateVapidKeys();
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const SUBJECT = "mailto:ops@brightwater.example";

const parse = (header: string) => {
  const t = header.match(/t=([^,]+)/)![1];
  const k = header.match(/k=(.+)$/)![1];
  const [h, c, s] = t.split(".");
  return {
    k,
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    claims: JSON.parse(Buffer.from(c, "base64url").toString()),
    signingInput: `${h}.${c}`,
    signature: Buffer.from(s, "base64url"),
  };
};

describe("the token", () => {
  it("verifies against the public key it advertises", async () => {
    const t = parse(vapidHeader({ endpoint: ENDPOINT, subject: SUBJECT, ...keys }));

    const pub = createPublicKey({
      key: { kty: "EC", crv: "P-256", ...publicJwkFrom(t.k) },
      format: "jwk",
    });

    /* Raw r‖s, not DER — node signs DER by default and a DER signature is
       rejected as malformed by every push service, silently as far as the
       sender can tell. */
    expect(t.signature).toHaveLength(64);
    const ok = createVerify("SHA256")
      .update(t.signingInput)
      .verify({ key: pub, dsaEncoding: "ieee-p1363" }, t.signature);
    expect(ok).toBe(true);
  });

  it("is scoped to the origin, not the subscription", async () => {
    const t = parse(vapidHeader({ endpoint: ENDPOINT, subject: SUBJECT, ...keys }));
    // the path identifies one person's browser; putting it in the token would
    // leak which endpoints exist to anyone who saw the header
    expect(t.claims.aud).toBe("https://fcm.googleapis.com");
    expect(t.claims.aud).not.toContain("abc123");
    expect(t.claims.sub).toBe(SUBJECT);
  });

  it("never asks for longer than the spec allows", async () => {
    const now = 1_800_000_000;
    const t = parse(vapidHeader({ endpoint: ENDPOINT, subject: SUBJECT, ...keys, expiresIn: 99999999, now }));
    // services reject anything past 24h outright, so clamping beats being told
    expect(t.claims.exp).toBe(now + 24 * 3600);
  });

  it("advertises the same key it was given", async () => {
    const t = parse(vapidHeader({ endpoint: ENDPOINT, subject: SUBJECT, ...keys }));
    expect(t.k).toBe(keys.publicKey);
    expect(t.header).toEqual({ typ: "JWT", alg: "ES256" });
  });
});

describe("the keypair", () => {
  it("is an uncompressed P-256 point the browser will accept", async () => {
    const raw = Buffer.from(keys.publicKey, "base64url");
    expect(raw).toHaveLength(65);
    expect(raw[0]).toBe(0x04);
  });

  it("is different every time", async () => {
    expect(generateVapidKeys().publicKey).not.toBe(generateVapidKeys().publicKey);
  });

  it("refuses a public key that is not one", async () => {
    // a key pasted with whitespace, or hex instead of base64url, fails here
    // rather than as a 401 that looks like the push service being down
    expect(() => publicJwkFrom("nope")).toThrow(/65 uncompressed bytes/);
  });
});

describe("DER to raw", () => {
  it("left-pads a short r or s rather than shifting the signature", async () => {
    /* DER strips leading zeros, so a signature with a small r yields fewer
       than 32 bytes. Copying it flush left would move every byte and the
       signature would fail to verify — intermittently, on roughly one
       signature in 256, which is the worst possible frequency. */
    const r = Buffer.from([0x01, 0x02]);
    const s = Buffer.alloc(32, 0xab);
    const der = Buffer.concat([
      Buffer.from([0x30, 4 + r.length + s.length, 0x02, r.length]), r,
      Buffer.from([0x02, s.length]), s,
    ]);

    const raw = derToRaw(der);
    expect(raw).toHaveLength(64);
    expect(raw.subarray(0, 30).every((b) => b === 0)).toBe(true);
    expect(raw.subarray(30, 32)).toEqual(r);
    expect(raw.subarray(32)).toEqual(s);
  });
});
