/* ============================================================
   GET /api/shifts?did=… — the board as one worker sees it.

   The console computes this inside a React provider and hides the
   Claim button from anyone Idara blocks. That is the right thing to
   render, and it is not a gate: the phone is a different process on
   a network the venue does not control. So the same answer is
   computed here, and POST /api/shifts/claim enforces it again.

   Blocked shifts are returned rather than filtered out, each with
   its reason. Hiding them would make the board look thin for no
   stated cause, and the reason is the useful part — "RSA expired 2
   May" is something a casual can act on, where a shift that simply
   is not there is not. It also matches what the console shows a
   manager, so the two views describe one world.
   ============================================================ */
import { NextResponse } from "next/server";
import { eventStore } from "@/lib/store/events";
import { boardFrom, claimBlockReason, seatsLeft, standingFor } from "@/lib/shifts";
import { LocalCredentialVerifier } from "@/lib/idara/verifier";
import { SITES, WORKERS } from "@/lib/idara/seed";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));
const siteIndex = new Map(SITES.map((s) => [s.id, s]));
const verifier = new LocalCredentialVerifier();

export async function GET(req: Request) {
  const did = new URL(req.url).searchParams.get("did");
  if (!did) return NextResponse.json({ error: "did is required" }, { status: 400 });

  const person = workerIndex.get(did);
  // an unknown did gets 404 rather than an empty board: "no shifts for you"
  // and "we do not know who you are" are different answers, and a phone
  // showing the first for the second would look like a quiet day
  if (!person) return NextResponse.json({ error: "unknown worker" }, { status: 404 });

  const board = boardFrom(eventStore().all(ORG));

  const shifts = board.postings
    // drafts are the manager's working copy and are not offers yet
    .filter((p) => p.status !== "draft")
    .map((p) => {
      const blockReason = claimBlockReason({
        posting: p,
        person,
        site: siteIndex.get(p.siteId),
        credentials: board.credentials.filter((c) => c.subject === did),
        at: board.at,
        verifier,
      });
      const standing = standingFor(p, did, blockReason);
      const left = seatsLeft(p);
      /* Being rostered on is not a standing. standingFor() answers about
         CLAIMS, and someone the manager assigned directly never made one — so
         without this the board offers a worker a shift they are already on,
         and the claim endpoint refuses it as a duplicate. The gate holds; the
         screen is what lies. */
      const rostered = p.assigned.includes(did);

      return {
        id: p.id,
        role: p.role,
        functionName: p.functionName,
        client: p.client ?? null,
        siteId: p.siteId,
        siteName: siteIndex.get(p.siteId)?.name ?? p.siteId,
        day: p.day,
        window: p.window,
        seats: p.seats,
        seatsLeft: left,
        duties: p.duties,
        requires: p.requires,
        status: p.status,
        blockReason,
        standing: standing ? { standing: standing.standing, at: standing.at, reason: standing.reason ?? null } : null,
        rostered,
        // one flag the phone can trust for the primary action, computed the
        // same way the claim endpoint will decide it
        claimable: !blockReason && left > 0 && p.status === "open" && !standing && !rostered,
      };
    });

  return NextResponse.json({
    worker: { did: person.did, name: person.name, role: person.role },
    at: board.at,
    shifts,
  });
}
