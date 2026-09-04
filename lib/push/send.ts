/* ============================================================
   Actually sending one.

   The two crypto halves are verified against their specs next door;
   this is the part where a real network and real push services get
   involved, and where the failures are operational rather than
   mathematical.

   The one that matters: a 404 or 410 means the subscription is gone
   — permission revoked, browser data cleared, app uninstalled — and
   the row must be deleted. Left alone it is retried on every posting
   forever, and the count of "people we notified" quietly includes
   devices that stopped existing months ago. That number is the one a
   manager would use to decide a shift is unfillable.

   Everything else is left to fail loudly rather than retried here.
   A push service being down is not something to paper over inside a
   request that is trying to return a posting to somebody.
   ============================================================ */
import { encryptPayload } from "./encrypt";
import { vapidHeader } from "./vapid";
import type { PushSubscriptionRow } from "@/lib/store/push";

export interface PushKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export type PushOutcome =
  | { ok: true; endpoint: string; status: number }
  /** the subscription is gone; the caller should forget it. */
  | { ok: false; endpoint: string; gone: true; status: number }
  | { ok: false; endpoint: string; gone: false; status: number; error: string };

/** How long to wait on a push service before giving up on it. */
const TIMEOUT_MS = 10_000;

/**
 * Send one payload to one device.
 *
 * TTL is how long the service holds it for a phone that is off. Four hours,
 * because a shift notification that arrives the next morning is worse than
 * none — the shift is gone and the notification is now a small lie.
 */
export async function sendPush(
  sub: PushSubscriptionRow,
  payload: string,
  keys: PushKeys,
  ttlSeconds = 4 * 3600,
): Promise<PushOutcome> {
  let body: Buffer;
  try {
    ({ body } = encryptPayload(payload, sub));
  } catch (e) {
    // a malformed stored key: not the service's fault, and not retryable
    return {
      ok: false, endpoint: sub.endpoint, gone: false, status: 0,
      error: e instanceof Error ? e.message : "could not encrypt",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        TTL: String(ttlSeconds),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        Authorization: vapidHeader({
          endpoint: sub.endpoint,
          subject: keys.subject,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        }),
      },
      body: new Uint8Array(body),
      signal: controller.signal,
    });

    if (res.ok) return { ok: true, endpoint: sub.endpoint, status: res.status };

    /* Gone for good, as opposed to failing today. Deleting on a 500 would
       throw away a working subscription because a push service had a bad
       afternoon. */
    if (res.status === 404 || res.status === 410) {
      return { ok: false, endpoint: sub.endpoint, gone: true, status: res.status };
    }

    return {
      ok: false, endpoint: sub.endpoint, gone: false, status: res.status,
      error: (await res.text().catch(() => "")).slice(0, 200) || `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false, endpoint: sub.endpoint, gone: false, status: 0,
      error: e instanceof Error ? e.message : "push failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
