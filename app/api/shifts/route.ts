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
import { boardFrom, isOffered, shiftViewFor } from "@/lib/shifts";
import { LocalCredentialVerifier } from "@/lib/idara/verifier";
import { SITES } from "@/lib/idara/seed";
import { workerOf } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

const siteIndex = new Map(SITES.map((s) => [s.id, s]));
const verifier = new LocalCredentialVerifier();

export async function GET(req: Request) {
  /* The did comes from the session, never from the request.

     It used to be a query parameter, which is not a weak identity check but
     the absence of one: any phone could ask for anybody’s board, and the
     claim endpoint would then act on the name it was handed. */
  const caller = await workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const did = caller.did;
  const person = caller.person;

  const board = boardFrom((await (await eventStore()).all(ORG)));

  /* One mapping, shared with GET /api/shifts/[id]. The list and the detail
     screen have to be describing the same shift — see lib/shifts/view.ts for
     the two times this repo paid for the alternative. */
  const shifts = board.postings
    .filter(isOffered)
    .map((p) =>
      shiftViewFor({
        posting: p,
        person,
        did,
        site: siteIndex.get(p.siteId),
        credentials: board.credentials.filter((c) => c.subject === did),
        at: board.at,
        verifier,
      }),
    );

  return NextResponse.json({
    worker: { did: person.did, name: person.name, role: person.role },
    at: board.at,
    shifts,
  });
}
