/* ============================================================
   Voluntary Application Server Identification — RFC 8292.

   The encryption proves the push service cannot read the message.
   This proves to the push service who is asking it to deliver one,
   so a stranger who obtained a subscription endpoint cannot spam it:
   the endpoint only accepts pushes signed by the key the browser
   subscribed with.

   Which makes the keypair the thing that matters here. It is stable
   for the life of the deployment — rotate it and every existing
   subscription stops working, because each was created against the
   public key it was given. That is not a disaster, it is a
   re-subscribe by every phone, and worth knowing before somebody
   treats these like a rotatable secret.

   ES256 over P-256, which is what the spec allows and what node
   already has. The signature has to be raw r‖s; node's default is
   DER, and a DER signature is silently rejected by push services as
   a malformed token — one of the two ways this goes wrong quietly.
   ============================================================ */
import { createSign, createPrivateKey, generateKeyPairSync } from "node:crypto";

const b64u = (b: Buffer) => b.toString("base64url");

export interface VapidKeys {
  /** the key browsers subscribe against, base64url, 65 bytes uncompressed. */
  publicKey: string;
  /** the signing key. Server-side only, and never sent anywhere. */
  privateKey: string;
}

/** A fresh keypair, in the base64url form the browser and the env both want. */
export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const priv = privateKey.export({ format: "jwk" }) as { d: string };

  return {
    // 0x04 marks an uncompressed point; the browser rejects anything else
    publicKey: b64u(
      Buffer.concat([
        Buffer.from([0x04]),
        Buffer.from(jwk.x, "base64url"),
        Buffer.from(jwk.y, "base64url"),
      ]),
    ),
    privateKey: priv.d,
  };
}

/** DER-encoded ECDSA signature to the raw r‖s form JWS requires. */
function derToRaw(der: Buffer): Buffer {
  // 0x30 len 0x02 rLen r 0x02 sLen s
  let offset = 3;
  const rLen = der[offset];
  offset += 1;
  const r = der.subarray(offset, offset + rLen);
  offset += rLen + 1;
  const sLen = der[offset];
  offset += 1;
  const s = der.subarray(offset, offset + sLen);

  const out = Buffer.alloc(64);
  // both halves are left-padded to 32 bytes; DER strips leading zeros and may
  // add one to keep a value positive, so neither length can be assumed
  Buffer.from(r.subarray(Math.max(0, r.length - 32))).copy(out, 32 - Math.min(32, r.length));
  Buffer.from(s.subarray(Math.max(0, s.length - 32))).copy(out, 64 - Math.min(32, s.length));
  return out;
}

export interface VapidOptions {
  /** the push endpoint being called; only its origin goes in the token. */
  endpoint: string;
  /** how the push service reaches a human about this deployment. */
  subject: string;
  privateKey: string;
  publicKey: string;
  /** seconds; the spec caps this at 24 hours and services enforce it. */
  expiresIn?: number;
  now?: number;
}

const MAX_EXPIRY_SECONDS = 24 * 3600;

/**
 * The Authorization header value for one push.
 *
 * Scoped to the endpoint's ORIGIN, not the full URL. A token minted for one
 * subscription is therefore reusable across every subscription on the same
 * service, which is what the spec intends — and means a leaked token is worth
 * as much as the key for its lifetime, which is why the expiry is short.
 */
export function vapidHeader(opts: VapidOptions): string {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const expiresIn = Math.min(opts.expiresIn ?? 12 * 3600, MAX_EXPIRY_SECONDS);

  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" }), "utf8"));
  const claims = b64u(
    Buffer.from(
      JSON.stringify({
        aud: new URL(opts.endpoint).origin,
        exp: now + expiresIn,
        sub: opts.subject,
      }),
      "utf8",
    ),
  );
  const signingInput = `${header}.${claims}`;

  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: opts.privateKey,
      // the JWK needs the public point too; derive it rather than asking the
      // caller to keep the halves in step
      ...publicJwkFrom(opts.publicKey),
    },
    format: "jwk",
  });

  const der = createSign("SHA256").update(signingInput).sign(key);
  const signature = b64u(derToRaw(der));

  return `vapid t=${signingInput}.${signature}, k=${opts.publicKey}`;
}

/** The x and y halves of an uncompressed public key, as JWK fields. */
function publicJwkFrom(publicKey: string): { x: string; y: string } {
  const raw = Buffer.from(publicKey, "base64url");
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error("VAPID public key must be 65 uncompressed bytes starting 0x04");
  }
  return { x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) };
}

/** Both halves from the environment, or null when push is not configured. */
export function vapidFromEnv(): (VapidKeys & { subject: string }) | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;

  /* Checked here rather than at the first push, because a malformed key
     produces a token the service rejects with a 401 that reads like an
     outage. Failing at configuration time names the actual problem. */
  publicJwkFrom(publicKey);
  return { publicKey, privateKey, subject };
}

export { publicJwkFrom, derToRaw };
