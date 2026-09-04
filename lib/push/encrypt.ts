/* ============================================================
   Message encryption for Web Push — RFC 8291, aes128gcm.

   Hand-rolled against node:crypto rather than pulled from a package,
   which is the same call this repo made for SHA-256 and for SQLite.
   The reason it is defensible here is that the spec publishes a
   worked example with fixed inputs and a fixed expected ciphertext,
   so the implementation can be checked against the standard itself
   rather than against my reading of it. tests/push-encrypt.test.ts
   reproduces RFC 8291 §5 byte for byte; if that ever fails, this is
   wrong and no amount of "it seemed to work" should override it.

   What it does: the push service must never see the message, so the
   payload is encrypted to a key only the subscriber's browser holds.
   The browser gave us its public key (p256dh) and a shared auth
   secret when it subscribed. We generate a throwaway keypair, do
   ECDH against theirs, mix in the auth secret, and derive the
   content-encryption key. The push service forwards opaque bytes.

   Every field width here is fixed by the spec, not chosen: 16-byte
   salt, 65-byte uncompressed public key, 4-byte record size, 16-byte
   GCM tag. The 0x02 delimiter is the padding byte that marks the
   final record.
   ============================================================ */
import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

const KEY_LENGTH = 16; // aes128
const NONCE_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const PUBLIC_KEY_LENGTH = 65;
/* The size records are split at. One record is always sent, so this is a
   declared ceiling rather than a measurement — and a payload that would not
   fit inside it is refused rather than silently truncated into something no
   browser can read. */
const RECORD_SIZE = 4096;

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

/** HKDF, returning a Buffer rather than an ArrayBuffer. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

export interface Subscriber {
  /** the browser's public key, base64url — "p256dh" in a PushSubscription. */
  p256dh: string;
  /** the shared secret the browser generated, base64url. */
  auth: string;
}

export interface EncryptedPayload {
  /** the body to POST: header block followed by ciphertext. */
  body: Buffer;
  /** goes in Content-Encoding. */
  encoding: "aes128gcm";
}

/**
 * Encrypt a payload for one subscriber.
 *
 * `salt` and `senderPrivate` are injectable so the RFC's test vector can be
 * reproduced exactly. Nothing in production passes them, and both default to
 * fresh randomness — a reused salt with the same keys would repeat a nonce,
 * which is the failure that takes GCM from secure to broken.
 */
export function encryptPayload(
  plaintext: string | Buffer,
  sub: Subscriber,
  opts: { salt?: Buffer; senderPrivate?: Buffer } = {},
): EncryptedPayload {
  const salt = opts.salt ?? randomBytes(SALT_LENGTH);
  const receiverPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);

  if (receiverPublic.length !== PUBLIC_KEY_LENGTH) {
    throw new Error(`p256dh must be ${PUBLIC_KEY_LENGTH} bytes, got ${receiverPublic.length}`);
  }

  const ecdh = createECDH("prime256v1");
  if (opts.senderPrivate) ecdh.setPrivateKey(opts.senderPrivate);
  else ecdh.generateKeys();
  const senderPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(receiverPublic);

  /* The input keying material binds the shared secret to BOTH public keys, so
     a shared secret alone is not enough to derive the key — the labels and the
     key order are fixed by §3.3 and are not interchangeable. */
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    receiverPublic,
    senderPublic,
  ]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  const contentEncryptionKey = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), KEY_LENGTH);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), NONCE_LENGTH);

  const body = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf8");
  // 0x02 marks the last record; there is only ever one here
  const padded = Buffer.concat([body, Buffer.from([0x02])]);

  if (padded.length + TAG_LENGTH > RECORD_SIZE) {
    throw new Error(
      `payload is ${body.length} bytes; one record holds ${RECORD_SIZE - TAG_LENGTH - 1}`,
    );
  }

  const cipher = createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  /* The header the receiver needs to derive the same key: salt, record size,
     and the sender's public key inline.

     Record size is the size records are SPLIT at, not the length of this one.
     Writing the payload length here produces a header that is wrong while the
     ciphertext is right — which is the worst shape available, because the push
     service still answers 201 and only the browser's decrypt fails, silently,
     on a phone nobody is watching. The RFC's own vector is what caught it. */
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE, 0);

  return {
    body: Buffer.concat([
      salt,
      recordSize,
      Buffer.from([senderPublic.length]),
      senderPublic,
      ciphertext,
    ]),
    encoding: "aes128gcm",
  };
}

export { b64u, fromB64u };
