/* ============================================================
   GET /api/shifts/[id] — one shift, as this worker sees it.

   The board endpoint answers "what work is going". This answers
   "tell me about that one", and it exists because until now a
   shift had no address. The detail lived in a bottom sheet built
   from a list the phone had already loaded, so a shift could only
   be reached by first loading every shift and then tapping it.

   That cost something real. public/sw.js puts `postingId` in every
   push notification and then throws it away on click, opening the
   whole board — because there was nowhere to send it. "Bartender,
   Friday, $41.50/h" would wake a phone and then ask the person to
   go and find it.

   It is a separate request rather than a filter over the board
   because the point is arriving cold: from a notification, a
   shared link, or a reload, with nothing loaded and no list to
   filter. Fetching the whole board to render one shift would make
   the deep link depend on the thing it exists to avoid.

   Same scoping rules as the board. The did comes from the session
   and never from the URL, drafts are refused, and the mapping is
   the shared one — see lib/shifts/view.ts.
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { did, person } = caller;

  const board = boardFrom(await (await eventStore()).all(ORG));
  const posting = board.postings.find((p) => p.id === id);

  /* A draft answers 404 rather than 403, and identically to a shift that does
     not exist. The difference between "no such shift" and "a shift you may not
     see" is a fact about the venue's unpublished work, and answering it turns
     a URL guess into a way to enumerate drafts. A rate a manager is still
     arguing about should not be one guessed id away from the worker it would
     underpay. */
  if (!posting || !isOffered(posting)) {
    return NextResponse.json({ error: "No such shift" }, { status: 404 });
  }

  return NextResponse.json({
    worker: { did, name: person.name, role: person.role },
    at: board.at,
    shift: shiftViewFor({
      posting,
      person,
      did,
      site: siteIndex.get(posting.siteId),
      credentials: board.credentials.filter((c) => c.subject === did),
      at: board.at,
      verifier,
    }),
  });
}
