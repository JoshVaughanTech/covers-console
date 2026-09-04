#!/usr/bin/env node
/* ============================================================
   Generate the VAPID keypair web push needs.

   Run once per deployment, put the output in .env, and do not lose
   the private half. Rotating it is not a secret rotation in the
   usual sense: every existing subscription was created against the
   public key it was given, so a new pair silently stops delivering
   to every phone already subscribed, and each has to turn alerts on
   again. Nothing breaks loudly — the pushes just start being
   rejected by services nobody is watching.

   The keys are a P-256 pair. The public half is not secret and is
   served to browsers by /api/push/subscribe.

   Usage:
     node scripts/generate-vapid-keys.mjs
   ============================================================ */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });

// 0x04 marks an uncompressed point, which is the only form a browser accepts
const pub = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(jwk.x, "base64url"),
  Buffer.from(jwk.y, "base64url"),
]).toString("base64url");

console.log(`
Add these to .env — the private key is a secret, the public one is not.

VAPID_PUBLIC_KEY=${pub}
VAPID_PRIVATE_KEY=${priv.d}
VAPID_SUBJECT=mailto:you@yourvenue.example

VAPID_SUBJECT must be a mailto: or https: URL a push service can use to
reach a human about this deployment. Some services reject a token without
a usable one, and none of them tell you that is why.
`);
