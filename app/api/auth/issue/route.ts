/* ============================================================
   POST /api/auth/issue — an operator mints a sign-in code for
   somebody else.

   The sibling of /api/auth/request, and different from it in one
   way that matters: this one is done ON BEHALF OF a worker by a
   named operator, so the chain records who decided, not only that
   somebody signed in. auth.code_issued is the cause; auth.signed_in
   is the effect; a disputed claim is read against both.

   What this route deliberately does NOT do is show the code to
   whoever called it. That was the whole of the bug closed in #10 and
   again in #11: an endpoint that answers with a live credential is
   an oracle, and the console has no login, so "an operator" here
   means anyone who can reach the server. The code goes wherever the
   configured sink sends it, and the operator is told where to look.
   With AUTH_CODES_DIR that is a file only server access can read;
   with the inline sink it comes back on screen, which is acceptable
   only because choosing that sink is now an explicit statement that
   anyone reachable can sign in as anyone.

   So the screen above this is honest rather than convenient, and a
   properly configured deployment does not gain a new way to leak a
   credential by having a nicer surface.
   ============================================================ */
import { NextResponse } from "next/server";
import { authStore } from "@/lib/store/auth";
import { eventStore } from "@/lib/store/events";
import { sinkFromEnv } from "@/lib/auth/delivery";
import { formatCode } from "@/lib/auth/token";
import { WORKERS } from "@/lib/idara/seed";
import { operatorOf } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));

export async function POST(req: Request) {
  /* The operator is now a session rather than a constant. Until console
     sign-in existed this route wrote CONSOLE_OPERATOR whoever was calling,
     which recorded a name and proved nothing; the screen said so. Now the
     name in the chain is the one that proved itself at the door. */
  const caller = (await operatorOf(req));
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: { did?: unknown };
  try {
    body = (await req.json()) as { did?: unknown };
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const did = typeof body.did === "string" ? body.did : null;
  if (!did) return NextResponse.json({ error: "did is required" }, { status: 400 });

  const person = workerIndex.get(did);
  /* Unlike the phone endpoint, this one tells the truth about an unknown
     worker. There is nobody to protect from enumeration here — the caller is
     looking at a list of these names — and an operator who mistypes needs to
     know they did. */
  if (!person) return NextResponse.json({ error: "unknown worker" }, { status: 404 });

  const sink = sinkFromEnv();
  // refuse before minting: a sink that cannot deliver would otherwise spend
  // this person's issue budget on a code nobody could ever receive
  if (!sink.configured) {
    return NextResponse.json(
      {
        error: "No sign-in delivery channel is configured on this server.",
        detail: "Set AUTH_CODES_DIR, or AUTH_CODES_INLINE=1 to accept that the code is shown here.",
      },
      { status: 503 },
    );
  }

  const issued = (await (await authStore()).issue(did));
  if (!issued.ok) {
    /* The operator is the one caller who must be told plainly that nothing was
       minted. The phone endpoint hides this on purpose; here, silence would
       have somebody read out a code that does not exist. */
    return NextResponse.json(
      {
        error: `${person.name} has been issued too many codes recently.`,
        detail: "Their most recent code is still valid. Wait, or use the one already issued.",
        reason: "rate_limited",
      },
      { status: 429 },
    );
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

  /* The cause, recorded. Carries the grant id — sha-256 of the token's digest,
     truncated — which correlates a mint with the redemption that follows and
     inverts to nothing. Never the code, never a hash of it: the audit screen
     is readable by anyone who can reach it, so a secret in the chain would be
     a credential published to the surface it protects. */
  const { event } = (await (await eventStore()).append(ORG, {
    type: "auth.code_issued",
    at: new Date().toISOString(),
    actor: caller.operator.name,
    actorDid: caller.operator.did,
    subject: person.did,
    summary: `${caller.operator.name} issued ${person.name} a sign-in code`,
    data: {
      grantId: grant.id,
      expiresAt: grant.expiresAt,
      deliveredTo: delivery.target,
      outOfBand: delivery.outOfBand,
    },
  }));

  return NextResponse.json({
    issued: true,
    worker: { did: person.did, name: person.name, role: person.role },
    expiresAt: grant.expiresAt,
    via: sink.describe(),
    outOfBand: delivery.outOfBand,
    // present only when the configured sink could not carry it out of band
    code: delivery.code ? formatCode(delivery.code) : undefined,
    recordedAs: { name: caller.operator.name, did: caller.operator.did },
    seq: event.seq,
  });
}
