/* ============================================================
   POST /api/auth/redeem — turn a code into a session.

   The did is required alongside the code, and that is a security
   property rather than a convenience: looked up by code alone, a
   wrong guess matches no grant and costs nobody an attempt, so the
   five-try limit binds only after a guesser has already found a real
   grant. Scoped to a person, every guess spends one of that person's
   five. See lib/store/auth.ts.

   Saying who you are is not claiming to be them — it is addressing.
   That is all picking a name from a list ever was; what is new is
   that something now checks.
   ============================================================ */
import { NextResponse } from "next/server";
import { authStore } from "@/lib/store/auth";
import { eventStore } from "@/lib/store/events";
import { setSessionCookie } from "@/lib/auth/session";
import { WORKERS } from "@/lib/idara/seed";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));

const MESSAGE: Record<string, string> = {
  unknown: "That code is not right. Ask for a new one if you need to.",
  expired: "That code has expired. Ask for a new one.",
  spent: "That code has already been used. Ask for a new one.",
  too_many_attempts: "Too many tries. Ask for a new code.",
};

/**
 * Who is asking, for throttling — the caller AND the person they are claiming
 * to be.
 *
 * Per-address alone would make a venue one bucket, so one person fumbling a
 * code read to them across a bar would lock out colleagues who did nothing.
 * Including the did means a failure only ever costs the person it was about.
 */
function bucketOf(req: Request, did: string): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  const caller = fwd || req.headers.get("x-real-ip") || "anon";
  return `${caller}|${did}`;
}

export async function POST(req: Request) {
  let body: { did?: unknown; code?: unknown };
  try {
    body = (await req.json()) as { did?: unknown; code?: unknown };
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const did = typeof body.did === "string" ? body.did : null;
  const code = typeof body.code === "string" ? body.code : null;
  if (!did || !code) {
    return NextResponse.json({ error: "did and code are required" }, { status: 400 });
  }

  const result = (await (await authStore()).redeemCode(did, code, bucketOf(req, did)));
  if (!result.ok) {
    return NextResponse.json(
      { error: MESSAGE[result.reason] ?? MESSAGE.unknown, reason: result.reason },
      { status: 401 },
    );
  }

  const person = workerIndex.get(result.did);
  const res = NextResponse.json({
    signedIn: true,
    worker: person ? { did: person.did, name: person.name, role: person.role } : { did: result.did },
    expiresAt: result.session.expiresAt,
  });
  setSessionCookie(res, req, result.session.secret);

  /* That somebody signed in belongs in the chain: it is a fact about a
     person, it never stops being true, and a claim later disputed is read
     alongside it. The secret that let them in does not, and does not leave
     the auth store. */
  (await (await eventStore()).append(ORG, {
    type: "auth.signed_in",
    at: new Date().toISOString(),
    actor: person?.name ?? result.did,
    actorDid: result.did,
    subject: result.did,
    summary: `${person?.name ?? result.did} signed in on a device`,
    data: { via: "code", sessionId: result.session.id },
  }));

  return res;
}
