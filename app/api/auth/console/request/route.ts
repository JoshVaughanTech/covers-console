/* ============================================================
   POST /api/auth/console/request — ask for a console sign-in code.

   The worker equivalent of this endpoint will hand the code back in
   the response when no channel is configured, because a demo that
   cannot be signed into is not demonstrable. This one will not, in
   any environment, for any configuration.

   The asymmetry is the point. A worker's code lets them see their
   own shifts. An operator's code lets them mint everybody else's
   credentials, so the channel that carries it has to prove something
   about who received it — and the only channel here that proves
   anything is a file on the server. Bootstrap is therefore "whoever
   can read the server's filesystem", which is a real trust anchor
   rather than an invented one, and it is more than the console has
   had at any point today.

   With no AUTH_CODES_DIR there is no way into the console at all.
   That is the correct answer rather than an inconvenience: a console
   nobody can sign into is a smaller problem than a console anyone
   can.
   ============================================================ */
import { NextResponse } from "next/server";
import { authStore } from "@/lib/store/auth";
import { eventStore } from "@/lib/store/events";
import { FileSink } from "@/lib/auth/delivery";
import { operator } from "@/lib/auth/operators";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

export async function POST(req: Request) {
  let body: { did?: unknown };
  try {
    body = (await req.json()) as { did?: unknown };
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const did = typeof body.did === "string" ? body.did : null;
  if (!did) return NextResponse.json({ error: "did is required" }, { status: 400 });

  /* Only ever a file. sinkFromEnv() is not consulted, because it can return
     the inline sink and this is the one code that must never travel that way.
     A future channel that proves delivery — email to a verified address —
     belongs here; the inline one never does. */
  const dir = process.env.AUTH_CODES_DIR;
  if (!dir) {
    return NextResponse.json(
      {
        error: "Console sign-in is not available on this server.",
        detail: "AUTH_CODES_DIR must be set: an operator code is only ever written to a file.",
      },
      { status: 503 },
    );
  }

  const sink = new FileSink(dir);
  if (!sink.configured) {
    return NextResponse.json(
      { error: "Console sign-in is not available on this server.", detail: sink.describe() },
      { status: 503 },
    );
  }

  const who = operator(did);
  /* Same answer for somebody who is not an operator. The console roster is
     shorter and more valuable than the staff list, and confirming a name is on
     it is worth more to an attacker than confirming somebody works here. */
  if (!who) return NextResponse.json({ sent: true });

  const issued = (await (await authStore()).issue(did, "operator"));
  if (!issued.ok) return NextResponse.json({ sent: true });

  const origin = new URL(req.url).origin;
  await sink.deliver({
    did,
    name: `${who.name} (console)`,
    code: issued.grant.code,
    link: `${origin}/api/auth/link?t=${encodeURIComponent(issued.grant.token)}`,
    expiresAt: issued.grant.expiresAt,
  });

  /* Same gap as the worker route, for the same reason. An operator who asks
     for their own console code produced a sign-in with no cause before it. */
  (await (await eventStore()).append(
    ORG,
    {
      type: "auth.code_issued",
      at: new Date().toISOString(),
      actor: "system",
      subject: who.did,
      summary: `${who.name} requested a console sign-in code`,
      data: {
        trigger: "self",
        kind: "operator",
        grantId: issued.grant.id,
        expiresAt: issued.grant.expiresAt,
        // where it went, never what it was
        deliveredTo: sink.describe(),
        outOfBand: true,
      },
    },
    { clientRef: `code:${issued.grant.id}` },
  ));

  // never the code, in any circumstance
  return NextResponse.json({ sent: true, expiresAt: issued.grant.expiresAt });
}
