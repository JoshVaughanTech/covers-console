/* ============================================================
   POST /api/shifts/claim — a worker puts their hand up.

   A claim is a request, never a roster change. It joins the
   manager's queue and does nothing else; the assignment that may
   follow is a separate decision, separately audited.

   Everything the phone sent is re-derived here. The posting comes
   from the chain, not the request; eligibility is recomputed rather
   than trusted; the claim itself is re-checked by claimShift(). The
   phone contributes exactly two facts — who is claiming and which
   posting — and both are validated. This is the point where "hiding
   a control is presentation, and presentation is not a gate" stops
   being a remark about a button and starts being about a network.

   The write is a single `shift.claimed` event carrying the posting
   id in data and the claimant as subject, because that is the shape
   replayPostings() folds. A claim persisted any other way would
   exist in storage and not on the board, and the screen would look
   broken when the event was what was missing.
   ============================================================ */
import { NextResponse } from "next/server";
import { eventStore } from "@/lib/store/events";
import { boardFrom, claimBlockReason, claimShift } from "@/lib/shifts";
import { LocalCredentialVerifier } from "@/lib/idara/verifier";
import { SITES } from "@/lib/idara/seed";
import { workerOf } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

const siteIndex = new Map(SITES.map((s) => [s.id, s]));
const verifier = new LocalCredentialVerifier();

interface ClaimBody {
  postingId?: unknown;
  /** the phone's own id for this attempt, so a retry is not a second claim. */
  clientRef?: unknown;
}

export async function POST(req: Request) {
  /* Who is claiming comes from the session, and it is checked before anything
     else is read. The phone used to send it, which meant anyone could put
     anyone else’s hand up and the audit chain would record it truthfully and
     uselessly. */
  const caller = workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const did = caller.did;
  const person = caller.person;

  let body: ClaimBody;
  try {
    body = (await req.json()) as ClaimBody;
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const postingId = typeof body.postingId === "string" ? body.postingId : null;
  if (!postingId) {
    return NextResponse.json({ error: "postingId is required" }, { status: 400 });
  }

  const store = eventStore();

  /* A retry is answered before anything is decided.

     append() dedups on the ref by itself, but only if we get that far — and we
     would not: the first claim is already on the board by then, so claimShift()
     would call the retry a duplicate and refuse a write that had in fact
     succeeded. The phone would show an error for a claim that is in the queue.

     The ref is namespaced with the claimant so one phone cannot present
     another worker's ref and be told about their claim. */
  const ref = typeof body.clientRef === "string" && body.clientRef ? `claim:${did}:${body.clientRef}` : null;
  if (ref) {
    const already = store.byClientRef(ORG, ref);
    if (already) {
      return NextResponse.json({
        claimed: true,
        created: false,
        postingId,
        at: already.at,
        seq: already.seq,
        hash: already.hash,
      });
    }
  }

  const board = boardFrom(store.all(ORG));
  const posting = board.postings.find((p) => p.id === postingId);
  if (!posting) return NextResponse.json({ error: "unknown posting" }, { status: 404 });

  // a draft is the manager's working copy; it has not been offered to anyone,
  // so a claim against one is refused rather than queued
  if (posting.status === "draft") {
    return NextResponse.json({ error: "This shift is not open yet", kind: "blocked" }, { status: 409 });
  }

  const blockReason = claimBlockReason({
    posting,
    person,
    site: siteIndex.get(posting.siteId),
    credentials: board.credentials.filter((c) => c.subject === did),
    at: board.at,
    verifier,
  });

  const result = claimShift(posting, did, new Date().toISOString(), blockReason);
  if (!result.ok) {
    // 409, not 403: every one of these is a state conflict rather than an
    // authorisation failure, and the phone shows the reason either way
    return NextResponse.json({ error: result.reason, kind: result.kind }, { status: 409 });
  }

  const { event, created } = store.append(
    ORG,
    {
      type: "shift.claimed",
      at: result.claim.at,
      actor: person.name,
      // the name is for reading; this is what identifies them
      actorDid: person.did,
      subject: person.did,
      summary: `${person.name} claimed ${posting.role} on ${posting.functionName}`,
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
    // belt and braces with the check above: that one answers a retry we can
    // see, this one closes the window where two arrive at once
    ref ? { clientRef: ref } : {},
  );

  return NextResponse.json(
    {
      claimed: true,
      created,
      postingId: posting.id,
      at: result.claim.at,
      seq: event.seq,
      hash: event.hash,
    },
    { status: created ? 201 : 200 },
  );
}
