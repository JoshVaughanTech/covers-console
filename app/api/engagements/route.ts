/* ============================================================
   GET /api/engagements — the worker's own employment offers.

   Worker sessions only. The console's view of the same engagements
   is /api/employer/engagements, and the split is the one lib/auth
   argues for: a route asks for the kind of caller it accepts and
   gets null for anything else, rather than resolving a session and
   branching on a field somebody will forget to check.

   The list is folded out of the chain every time. There is no
   engagements table to fall behind it, so an engagement the audit
   log describes and one this endpoint returns cannot disagree.
   ============================================================ */
import { NextResponse } from "next/server";
import { workerOf } from "@/lib/auth/session";
import { eventStore } from "@/lib/store/events";
import { engagementsFor } from "@/lib/idara/engagement";
import { describeEngagement, standingOfEngagement } from "@/lib/idara/engagement-view";
import { packOf } from "@/lib/idara/pack-seed";
import { completenessOf, thresholdNotice } from "@/lib/idara/pack";
import { employerOf } from "@/lib/idara/employer-seed";
import { TODAY } from "@/lib/idara/seed";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

export async function GET(req: Request) {
  const caller = workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const pack = packOf(caller.did);
  const at = TODAY;
  const completeness = pack ? completenessOf(pack, at) : null;

  const engagements = engagementsFor(eventStore().all(ORG), caller.did).map((e) => {
    const view = describeEngagement(e);
    const employer = employerOf(e.employerDid);
    return {
      ...view,
      standing: standingOfEngagement(e),
      /* The threshold line, computed against the pack as it stands rather
         than as it stood at proposal. Somebody who moved their nomination
         after the offer landed should see what that means before they sign,
         not after the declaration is lodged. */
      thresholdNotice:
        pack && employer ? thresholdNotice(pack, employer.did, employer.tradingName) : null,
      /* Signing is refused when the pack has since lapsed, and the sheet says
         so before the tap rather than the endpoint saying so after it. The
         endpoint refuses too — this is the courtesy, not the gate. */
      blockedBy:
        completeness && !completeness.ok
          ? `Your pack is missing ${completeness.missing.length} item${completeness.missing.length === 1 ? "" : "s"}.`
          : null,
    };
  });

  return NextResponse.json({
    worker: { did: caller.person.did, name: caller.person.name, role: caller.person.role },
    at,
    packComplete: completeness?.ok ?? false,
    engagements,
  });
}
