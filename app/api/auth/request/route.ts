/* ============================================================
   POST /api/auth/request — ask for a sign-in code.

   Open by design: asking for a code is not an authenticated act in
   any magic-link system. What makes that safe is that the code goes
   somewhere the requester does not control, which is the delivery
   sink's job and, with no mail transport here, is the part that is
   currently weakest. The response says which sink answered and
   whether it proved anything, rather than letting a screen imply a
   channel that does not exist.

   The reply is deliberately the same whether or not the did is one
   we know. A different answer for an unknown person turns this into
   a way to enumerate who works here.
   ============================================================ */
import { NextResponse } from "next/server";
import { authStore } from "@/lib/store/auth";
import { eventStore } from "@/lib/store/events";
import { sinkFromEnv } from "@/lib/auth/delivery";
import { formatCode } from "@/lib/auth/token";
import { WORKERS } from "@/lib/idara/seed";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));

export async function POST(req: Request) {
  let body: { did?: unknown };
  try {
    body = (await req.json()) as { did?: unknown };
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const did = typeof body.did === "string" ? body.did : null;
  if (!did) return NextResponse.json({ error: "did is required" }, { status: 400 });

  const sink = sinkFromEnv();

  /* Refuse before minting anything. A sink that cannot deliver would otherwise
     throw after the grant was issued, spending the person’s issue budget on a
     code nobody could ever receive — and returning a 500 that reads like a bug
     rather than the configuration problem it is. */
  if (!sink.configured) {
    return NextResponse.json(
      { error: "No sign-in delivery channel is configured on this server." },
      { status: 503 },
    );
  }

  const person = workerIndex.get(did);

  /* Same shape of answer either way. An unknown did costs a round trip and
     tells the caller nothing they did not already supply. */
  if (!person) {
    return NextResponse.json({ sent: true, via: sink.describe(), outOfBand: true });
  }

  const issued = await (await authStore()).issue(did);

  /* Refused for asking too often. Answered exactly like a success, because the
     difference is not the caller’s business and telling them apart would say
     which names are being hammered. The code already outstanding is untouched,
     so the one the manager is reading out still works. */
  if (!issued.ok) {
    return NextResponse.json({ sent: true, via: sink.describe(), outOfBand: true });
  }

  const grant = issued.grant;
  const origin = new URL(req.url).origin;
  const link = `${origin}/api/auth/link?t=${encodeURIComponent(grant.token)}`;

  const delivery = await sink.deliver({
    did,
    name: person.name,
    code: grant.code,
    link,
    expiresAt: grant.expiresAt,
  });

  /* The cause, for a code nobody else asked for.

     auth.code_issued was wired into the operator route when it was built and
     never into this one, so a worker who requested their own code produced an
     auth.signed_in with nothing before it — the exact gap the event type
     exists to close, left half open.

     actor "system" rather than the worker: nobody authorised this, the person
     asked and the server answered. The trigger says which of the two happened,
     because "Emma minted a code for Darie" and "Darie asked for one" are
     different facts and a dispute turns on which. */
  await (await eventStore()).append(
    ORG,
    {
      type: "auth.code_issued",
      at: new Date().toISOString(),
      actor: "system",
      subject: person.did,
      summary: `${person.name} requested a sign-in code`,
      data: {
        trigger: "self",
        grantId: grant.id,
        expiresAt: grant.expiresAt,
        deliveredTo: delivery.target,
        outOfBand: delivery.outOfBand,
      },
    },
    // one record per grant, however many times a flaky phone retries
    { clientRef: `code:${grant.id}` },
  );

  return NextResponse.json({
    sent: true,
    via: sink.describe(),
    outOfBand: delivery.outOfBand,
    expiresAt: grant.expiresAt,
    // present only when no channel could carry it, and the screens say so
    code: delivery.code ? formatCode(delivery.code) : undefined,
  });
}
