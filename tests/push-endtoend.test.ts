import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer } from "node:http";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { sendPush } from "../lib/push/send";
import { generateVapidKeys } from "../lib/push/vapid";

/* ============================================================
   A push, all the way to something that decrypts it.

   The RFC vector proves the encryption matches the spec. This
   proves the pieces are wired to each other: real keys, a real HTTP
   round trip, and a receiver that derives its own key from its own
   private half and reads the message back.

   It matters because every layer here fails silently. A wrong header
   still returns 201. A wrong key still produces ciphertext. The only
   assertion worth making is that somebody holding the other half can
   read what was sent — which is what a phone does, and what nothing
   short of this checks.
   ============================================================ */

afterEach(() => vi.restoreAllMocks());

/** A browser: generates a keypair and an auth secret, then decrypts. */
function makeSubscriber() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);

  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: auth.toString("base64url"),

    decrypt(body: Buffer): string {
      const salt = body.subarray(0, 16);
      const keyLength = body[20];
      const senderPublic = body.subarray(21, 21 + keyLength);
      const ciphertext = body.subarray(21 + keyLength);

      const shared = ecdh.computeSecret(senderPublic);
      const ikm = Buffer.from(
        hkdfSync("sha256", shared, auth,
          Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), senderPublic]), 32),
      );
      const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
      const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

      const tag = ciphertext.subarray(ciphertext.length - 16);
      const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([
        decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
        decipher.final(),
      ]);
      // strip the 0x02 last-record delimiter
      return plain.subarray(0, plain.length - 1).toString("utf8");
    },
  };
}

describe("a push, end to end", () => {
  it("arrives as something the subscriber can read", async () => {
    const browser = makeSubscriber();
    const keys = { ...generateVapidKeys(), subject: "mailto:ops@example.test" };
    const message = JSON.stringify({ title: "Bartender · Sun, 19 May", postingId: "sp-1" });

    let received: Buffer | null = null;
    let headers: Record<string, string | string[] | undefined> = {};

    /* A stand-in push service on a real socket. It only forwards bytes, which
       is exactly what a real one does — it cannot read the payload either. */
    const server = createServer((req, res) => {
      headers = req.headers;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received = Buffer.concat(chunks);
        res.writeHead(201).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };

    try {
      const result = await sendPush(
        { did: "w", endpoint: `http://127.0.0.1:${port}/push/abc`, p256dh: browser.p256dh, auth: browser.auth },
        message,
        keys,
      );

      expect(result.ok).toBe(true);
      expect(headers["content-encoding"]).toBe("aes128gcm");
      expect(String(headers.authorization)).toContain(`k=${keys.publicKey}`);

      expect(received).not.toBeNull();
      // the service saw ciphertext...
      expect(received!.toString("utf8")).not.toContain("Bartender");
      // ...and the subscriber reads the message back
      expect(browser.decrypt(received!)).toBe(message);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("cannot be read with the wrong private key", async () => {
    const browser = makeSubscriber();
    const impostor = makeSubscriber();
    const keys = { ...generateVapidKeys(), subject: "mailto:ops@example.test" };

    let received: Buffer | null = null;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => { received = Buffer.concat(chunks); res.writeHead(201).end(); });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };

    try {
      await sendPush(
        { did: "w", endpoint: `http://127.0.0.1:${port}/p`, p256dh: browser.p256dh, auth: browser.auth },
        "a shift",
        keys,
      );
      // the whole point of encrypting: the push service, or anyone who
      // intercepted the bytes, holds something they cannot open
      expect(() => impostor.decrypt(received!)).toThrow();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
