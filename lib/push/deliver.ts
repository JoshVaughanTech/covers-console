/* ============================================================
   Getting an offer to a phone that is not open.

   The seam the notification work left for exactly this. offerPosting
   makes the offer true — chain event, rows on each worker — and this
   carries it somewhere. Everything above stays the same whether this
   exists or not, which is why an unconfigured deployment degrades to
   what it had before rather than breaking.

   Deliberately best-effort and never fatal. A push service being
   slow must not fail the request that is posting a shift: the
   posting is the consequential act and it is already in the chain,
   while a notification is a convenience layered on top. A manager
   whose posting failed because Firefox was having an afternoon
   would reasonably conclude the product is broken.

   Dead subscriptions are pruned as they are found. A 410 is the only
   reliable signal a device is gone, and it only arrives when you try
   — so the attempt is also the cleanup, and a store nobody ever
   sends to would fill with corpses.
   ============================================================ */
import { pushStore } from "@/lib/store/push";
import { sendPush } from "./send";
import { vapidFromEnv } from "./vapid";

export interface DeliveryReport {
  /** devices that accepted it. */
  delivered: number;
  /** subscriptions the service said no longer exist, now removed. */
  pruned: number;
  /** failures worth looking at, as opposed to devices that are gone. */
  failed: number;
  /** false when push is not configured at all, which is not a failure. */
  attempted: boolean;
}

export interface OfferPush {
  postingId: string;
  role: string;
  functionName: string;
  day: string;
  window: string;
  siteName: string;
}

/**
 * Tell these people's devices about a shift.
 *
 * Returns a report rather than throwing. The caller records what happened and
 * carries on; nothing here is worth failing a posting over.
 */
export async function pushOffer(
  orgId: string,
  dids: string[],
  shift: OfferPush,
): Promise<DeliveryReport> {
  const keys = vapidFromEnv();
  // not configured is a state, not an error — say so rather than reporting
  // zero deliveries, which reads like every device failed
  if (!keys || dids.length === 0) {
    return { delivered: 0, pruned: 0, failed: 0, attempted: false };
  }

  const store = await pushStore();
  const subs = (await Promise.all(dids.map((did) => store.forWorker(orgId, did)))).flat();
  if (subs.length === 0) return { delivered: 0, pruned: 0, failed: 0, attempted: true };

  /* What the service worker renders. Deliberately thin: enough to decide
     whether to get off the sofa, and a posting id to open. The chain holds
     the detail, and a push payload sits on a lock screen where somebody
     else can read it. */
  const payload = JSON.stringify({
    title: `${shift.role} · ${shift.day}`,
    body: `${shift.functionName} · ${shift.window} · ${shift.siteName}`,
    postingId: shift.postingId,
  });

  const results = await Promise.all(subs.map((s) => sendPush(s, payload, keys)));

  let delivered = 0;
  let pruned = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok) delivered++;
    else if (r.gone) {
      // the attempt is the only way to learn this, so it is also the cleanup
      await store.remove(orgId, r.endpoint);
      pruned++;
    } else failed++;
  }

  return { delivered, pruned, failed, attempted: true };
}
