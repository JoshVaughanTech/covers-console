/* ============================================================
   POST /api/shifts/post — a venue publishes a shift.

   Until now there was no server side to posting at all. The console
   built the posting in the browser, ran the award floor check
   there, and wrote the resulting `shift.posted` event straight to
   /api/events — which accepts any well-formed event from any
   operator. So the refusal that makes "Covers will not publish
   below the award" true was reachable only by people using the
   form.

   That was demonstrated rather than suspected: with an operator
   session, a Friday 17:00–01:00 casual Level 2 shift offering
   $30.00/h posted successfully and appeared on a worker's board as
   claimable, against a $40.62/h Saturday floor — short by $10.62 an
   hour. The board rendered it correctly as below the floor. Nothing
   declined to publish it.

   This repo already says the right thing about the other direction:
   "hiding a control is presentation, and presentation is not a
   gate." Claiming has enforced that since it was written. Posting
   did not, and a second posting screen would have been a second
   place the gate did not hold.

   So the gate runs here. buildPosting() is the same function the
   form calls, which matters more than it looks: two implementations
   of "is this above the award" is how they come to disagree, and
   the one a worker is paid against has to be the one that refused.

   Operators only, because posting a shift commits a venue to paying
   somebody. Workers claim; operators offer.
   ============================================================ */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eventStore } from "@/lib/store/events";
import { boardFrom, buildPosting, emptyDraft, type PostingDraft } from "@/lib/shifts";
import { operatorOf } from "@/lib/auth/session";
import { offerPosting } from "@/lib/notify/offer";
import { notificationStore } from "@/lib/store/notifications";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

/**
 * A draft from an untrusted body.
 *
 * Every field is coerced to the shape validateDraft() expects rather than
 * trusted to arrive as one. buildPosting() calls `.trim()` on the strings, so
 * a number where a string belongs would be a 500 reporting a bug in this route
 * rather than a 422 reporting a bad request — and the difference matters when
 * the sender is a phone on a network the venue does not control.
 */
function draftFrom(body: Record<string, unknown>): PostingDraft {
  const str = (k: keyof PostingDraft) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const base = emptyDraft();
  return {
    ...base,
    role: str("role"),
    seats: str("seats") || base.seats,
    functionName: str("functionName"),
    functionRef: str("functionRef"),
    client: str("client"),
    siteId: str("siteId"),
    day: str("day"),
    window: str("window"),
    duties: Array.isArray(body.duties) ? (body.duties.filter((d) => typeof d === "string") as PostingDraft["duties"]) : [],
    requires: Array.isArray(body.requires) ? (body.requires as PostingDraft["requires"]) : [],
    publish: body.publish !== false,
    date: str("date"),
    startTime: str("startTime"),
    endTime: str("endTime"),
    level: str("level"),
    /* Anything unrecognised falls to casual, which is the dearest floor —
       so a malformed body is priced ABOVE what it should be and refused, never
       published cheap. Same reasoning as emptyDraft()'s default. */
    employment: body.employment === "full_time" || body.employment === "part_time" ? body.employment : "casual",
    rate: str("rate"),
    unpaidBreakMin: str("unpaidBreakMin"),
  };
}

export async function POST(req: Request) {
  const caller = await operatorOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const draft = draftFrom(body);

  const store = await eventStore();
  const board = boardFrom(await store.all(ORG));

  /* The id is minted here and never taken from the request. A caller-supplied
     id could collide with a seeded posting, and replayPostings() folds by id —
     so the collision would not create a second shift, it would silently
     overwrite one that already had claims against it. */
  const id = `sp-${randomUUID().slice(0, 8)}`;
  if (board.postings.some((p) => p.id === id)) {
    return NextResponse.json({ error: "id collision, retry" }, { status: 503 });
  }

  // matches the console's shiftId, so a posting made on a phone and one made
  // at a desk are the same shape in the log
  const shiftId = draft.day.trim().slice(0, 3) || "Shift";

  const result = buildPosting(draft, id, shiftId);
  if (!result.ok) {
    /* 422, not 400. The body parsed and the fields were the right kind; what
       failed is the content — usually the rate, which is the one a manager has
       to go and negotiate rather than retype. */
    return NextResponse.json({ error: "Cannot post this shift", errors: result.errors }, { status: 422 });
  }

  const posting = result.posting;

  /* One ref per attempt, so a phone that retries a request it never saw the
     answer to does not publish the shift twice. */
  const clientRef = typeof body.clientRef === "string" && body.clientRef ? `post:${caller.did}:${body.clientRef}` : null;

  const { event, created } = await store.append(
    ORG,
    {
      type: "shift.posted",
      at: board.at,
      actor: caller.operator.name,
      actorDid: caller.did,
      summary: `${posting.role} · ${posting.functionName} posted (${posting.seats} seat${posting.seats === 1 ? "" : "s"})`,
      /* The posting travels in the event because the board is rebuilt by
         folding this log over the seed. A posting persisted anywhere else
         would exist in storage and not on the board. */
      data: { postingId: posting.id, posting, via: "mobile" },
    },
    clientRef ? { clientRef } : {},
  );

  /* A posting nobody hears about fills as slowly as no posting at all.

     /api/events runs this behind its own append, with a comment saying it
     belongs there "so every posting notifies, including one made by a screen
     nobody has written yet" — this is that screen. Appending directly and
     forgetting would have shipped a posting route whose shifts silently
     reached nobody's phone, which looks exactly like a posting route that
     works. Only on a genuinely new append: a replayed clientRef must not
     re-offer, or a retry would push the same shift twice. */
  const offer = created ? await offerPosting(store, await notificationStore(), ORG, event) : null;

  /* On a replayed clientRef, answer with the posting that was STORED rather
     than the one just built. The id is minted per request, so the rebuilt one
     carries an id nothing has — a phone retrying a request whose answer it
     never saw would be handed a shift id the board cannot resolve, and a link
     to it would 404 on a shift that posted perfectly well. */
  const stored = (event.data as { posting?: typeof posting } | undefined)?.posting ?? posting;

  return NextResponse.json(
    { posted: true, created, seq: event.seq, posting: created ? posting : stored, ...(offer ? { offered: offer } : {}) },
    { status: created ? 201 : 200 },
  );
}
