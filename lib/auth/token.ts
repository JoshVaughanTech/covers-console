/* ============================================================
   Sign-in secrets.

   Server-only, and deliberately not built on lib/idara/hash. That
   module hand-rolls SHA-256 because the audit chain is also built in
   the browser; this runs nowhere but the server, where node:crypto is
   both faster and the thing a reviewer expects to find guarding a
   credential.

   Two presentations of one secret, because there is no mail service
   here and there may never be one at a venue:

     a link  — 32 random bytes, for the day there is a transport
     a code  — eight characters a duty manager can read aloud across
               a bar without spelling anything twice

   The code is the weaker of the two and is what makes the rest of
   this module careful. Eight characters of a 32-symbol alphabet is
   about 1.1e12 combinations, which is ample against a stranger and
   nothing at all against an unthrottled robot — so it lives or dies
   on the short expiry, the single use, and the attempt limit that
   the store enforces around it.
   ============================================================ */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** No I, O, 0 or 1: those are the pairs people mishear and mistype. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** How long a sign-in secret is good for. */
export const TOKEN_TTL_SECONDS = 15 * 60;

/** How long a session lasts once signed in. A casual's phone, not a bank. */
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;

/** Wrong guesses a single code tolerates before it is dead. */
export const MAX_ATTEMPTS = 5;

export interface MintedToken {
  /** the long secret, for a URL. Shown once and never stored. */
  token: string;
  /** the same grant, as something sayable. Shown once and never stored. */
  code: string;
  /** what the database keeps: no one holding this can sign in with it. */
  tokenHash: string;
  codeHash: string;
  expiresAt: number;
}

/** sha-256, hex. */
export function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Compare two hex digests without leaking where they diverge.
 *
 * Both operands are digests of a fixed length, so the length check below is
 * about malformed input rather than about secrets — timingSafeEqual throws on
 * a length mismatch and a thrown auth check is a failed one.
 */
export function digestEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Group as XXXX-XXXX. Only for display; never for storage or comparison. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Accept what someone actually typed.
 *
 * People add the hyphen or leave it out, use lower case, and paste a trailing
 * space. None of those is a wrong code, and treating them as one spends an
 * attempt from a budget of five.
 */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function randomCode(): string {
  let out = "";
  // randomInt, not Math.random: this is a credential, and the modulo bias of
  // a naive byte-to-alphabet mapping is a real if small skew
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** A fresh grant. The plaintext exists only in the return value. */
export function mint(now = Math.floor(Date.now() / 1000)): MintedToken {
  const token = randomBytes(32).toString("base64url");
  const code = randomCode();
  return {
    token,
    code,
    tokenHash: hash(token),
    codeHash: hash(code),
    expiresAt: now + TOKEN_TTL_SECONDS,
  };
}

/** A session secret. Same treatment: the store keeps only the digest. */
export function mintSession(now = Math.floor(Date.now() / 1000)): {
  secret: string;
  secretHash: string;
  expiresAt: number;
} {
  const secret = randomBytes(32).toString("base64url");
  return { secret, secretHash: hash(secret), expiresAt: now + SESSION_TTL_SECONDS };
}
