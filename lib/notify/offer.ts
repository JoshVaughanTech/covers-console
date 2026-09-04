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

   What this is NOT is delivery. Nothing here reaches a phone that is
   not already open — there is no push service, no SMS and no mail
   transport configured, the same wall the payroll report and the
   sign-in codes hit. What it does is make the offer a fact the
   moment it happens, so a transport added later has something true
   to send rather than a guess reconstructed from who happens to be
   eligible at the time it runs.
   ============================================================ */
import { audienceFor } from "./audience";
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

  return { postingId: posting.id, told: audience.eligible.length, blocked: audience.blocked };
}
