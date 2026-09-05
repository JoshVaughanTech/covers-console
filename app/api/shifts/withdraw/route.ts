/* ============================================================
   POST /api/shifts/withdraw — a worker taking their hand back down.

   The mirror of /api/shifts/claim, and it enforces the same way:
   the did comes from the session and never from the body, so one
   phone cannot withdraw another worker's claim.

   No eligibility check, deliberately. Claiming is gated because it
   asks to be put on a roster; withdrawing asks to be taken off a
   queue, and there is no state of the world where somebody must
   stay in one. Gating this would mean a worker whose RSA lapsed
   after claiming is stuck in a queue they cannot leave and cannot
   be granted from — the worst of both.

   Being rostered is the one refusal, and it comes from
   withdrawClaim() rather than from here: once a manager has
   assigned the shift, dropping it leaves a venue short and belongs
   in a conversation, not a button.
   ============================================================ */
import { NextResponse } from "next/server";
import { eventStore } from "@/lib/store/events";
import { boardFrom, withdrawClaim } from "@/lib/shifts";
import { workerOf } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

interface WithdrawBody {
  postingId?: unknown;
  clientRef?: unknown;
}

export async function POST(req: Request) {
  const caller = (await workerOf(req));
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { did, person } = caller;

  let body: WithdrawBody;
  try {
    body = (await req.json()) as WithdrawBody;
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const postingId = typeof body.postingId === "string" ? body.postingId : null;
  if (!postingId) {
    return NextResponse.json({ error: "postingId is required" }, { status: 400 });
  }

  const store = (await eventStore());

  /* Answered before the board is read, for the reason the claim route gives:
     by the time a retry arrives the first withdrawal has already removed the
     claim, so withdrawClaim() would call it "no claim to withdraw" and report
     a failure for a write that succeeded. */
  const ref =
    typeof body.clientRef === "string" && body.clientRef ? `withdraw:${did}:${body.clientRef}` : null;
  if (ref) {
    const already = await store.byClientRef(ORG, ref);
    if (already) {
      return NextResponse.json({
        withdrawn: true,
        created: false,
        postingId,
        at: already.at,
        seq: already.seq,
        hash: already.hash,
      });
    }
  }

  const board = boardFrom(await store.all(ORG));
  const posting = board.postings.find((p) => p.id === postingId);
  if (!posting) return NextResponse.json({ error: "unknown posting" }, { status: 404 });

  const result = withdrawClaim(posting, did);
  if (!result.ok) {
    // a state conflict, not an authorisation failure — same as the claim route
    return NextResponse.json({ error: result.reason, kind: result.kind }, { status: 409 });
  }

  const { event, created } = await store.append(
    ORG,
    {
      type: "shift.withdrawn",
      at: new Date().toISOString(),
      actor: person.name,
      actorDid: person.did,
      subject: person.did,
      summary: `${person.name} withdrew from ${posting.role} on ${posting.functionName}`,
      data: {
        postingId: posting.id,
        role: posting.role,
        functionName: posting.functionName,
        siteId: posting.siteId,
        day: posting.day,
        window: posting.window,
        via: "mobile",
      },
    },
    ref ? { clientRef: ref } : {},
  );

  return NextResponse.json({
    withdrawn: true,
    created,
    postingId,
    at: event.at,
    seq: event.seq,
    hash: event.hash,
  });
}
