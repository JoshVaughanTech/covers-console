/* ============================================================
   Telling people a shift exists.

   Runs when a posting lands, not when a screen remembers to ask.
   Putting it behind the append means every posting notifies —
   including one made by a future screen nobody has written yet, and
   including one replayed by a script. A notify() call at the call
   site would have been one more thing to forget, and forgetting it
   would be silent: the posting appears, nobody hears, and the board
   looks quiet rather than broken.

   Two writes, and the split is the point. The offer goes in the
   chain because "I was never told about that shift" has to be
   answerable later. The per-worker rows go in a table because
   whether somebody has read it is mutable, and mutable state has no
   business in an append-only log.

   Delivery goes out from here when push is configured, and is
   deliberately not awaited: the offer is already a fact in the
   chain, and a push service having a slow afternoon must not fail
   the posting that caused it. With no VAPID keys set, nothing is
   attempted and the phone shows the offer the next time it is
   opened — the same behaviour this had before push existed.
   ============================================================ */
import { audienceFor } from "./audience";
import { pushOffer } from "@/lib/push/deliver";
import { credentialsNow } from "@/lib/shifts";
import type { ShiftPosting } from "@/lib/shifts";
import type { EventStore } from "@/lib/store/events";
import type { NotificationStore } from "@/lib/store/notifications";
import { SITES, TODAY } from "@/lib/idara/seed";
import type { AuditEvent } from "@/lib/idara/types";

const siteIndex = new Map(SITES.map((s) => [s.id, s]));

export interface OfferResult {
  postingId: string;
  told: number;
  blocked: Record<string, number>;
}

/** Is this the event that means a shift is now open to be claimed? */
export function isOfferable(e: { type: string; data?: Record<string, unknown> }): boolean {
  if (e.type !== "shift.posted") return false;
  const posting = e.data?.posting as ShiftPosting | undefined;
  // a draft is the manager's working copy and has been offered to nobody
  return Boolean(posting && posting.status === "open");
}

/**
 * Work out who can take this shift, record that they were told, and give
 * each of them a row on their phone.
 *
 * Returns null when the event is not a posting, or names nobody — a shift
 * with an empty audience is worth recording as such, so `told: 0` is a
 * result rather than a silence.
 */
export function offerPosting(
  events: EventStore,
  notifications: NotificationStore,
  orgId: string,
  e: AuditEvent,
): OfferResult | null {
  if (!isOfferable(e)) return null;
  const posting = e.data.posting as ShiftPosting;

  const audience = audienceFor({
    posting,
    credentials: credentialsNow(events.all(orgId)),
    at: TODAY,
  });

  const at = new Date().toISOString();
  const siteName = siteIndex.get(posting.siteId)?.name ?? posting.siteId;

  notifications.offer(orgId, audience.eligible, {
    postingId: posting.id,
    role: posting.role,
    functionName: posting.functionName,
    day: posting.day,
    window: posting.window,
    siteName,
  }, at);

  events.append(
    orgId,
    {
      type: "shift.offered",
      at,
      // the posting was somebody's decision; telling people is the system
      // carrying it out, and inventing a person for that would be a lie
      actor: "system",
      summary:
        `${posting.role} · ${posting.functionName} offered to ${audience.eligible.length} ` +
        `${audience.eligible.length === 1 ? "person" : "people"}`,
      data: {
        postingId: posting.id,
        audience: audience.eligible,
        blocked: audience.blocked,
      },
    },
    // one offer per posting however many times an append is retried
    { clientRef: `offer:${posting.id}` },
  );

  /* Carry it to phones that are not open.

     Deliberately not awaited. The posting is the consequential act and it is
     already in the chain; a notification is a convenience on top, and a
     manager whose posting failed because a push service was slow would
     reasonably conclude the product is broken. Errors are swallowed for the
     same reason and reported nowhere the poster can see, which is the honest
     trade — the offer is recorded either way, and the phone will show it the
     next time it is opened. */
  void pushOffer(orgId, audience.eligible, {
    postingId: posting.id,
    role: posting.role,
    functionName: posting.functionName,
    day: posting.day,
    window: posting.window,
    siteName,
  }).catch(() => {});

  return { postingId: posting.id, told: audience.eligible.length, blocked: audience.blocked };
}
