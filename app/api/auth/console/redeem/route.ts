/* ============================================================
   POST /api/auth/console/redeem — turn an operator code into a
   console session.

   Separate from the worker redemption for one reason: the session it
   mints has different powers, and the kind comes from the grant
   rather than from which endpoint was called. That means this route
   cannot accidentally promote a worker's grant — redeemCode reads
   the kind off the row it found, and a worker's row says worker.
   The check below is belt and braces on top of that, and it is worth
   having because the failure it guards against is the whole reason
   sessions carry a kind.
   ============================================================ */
import { NextResponse } from "next/server";
import { authStore } from "@/lib/store/auth";
import { eventStore } from "@/lib/store/events";
import { setSessionCookie } from "@/lib/auth/session";
import { operator } from "@/lib/auth/operators";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

const MESSAGE: Record<string, string> = {
  unknown: "That code is not right.",
  expired: "That code has expired. Ask for a new one.",
  spent: "That code has already been used.",
  too_many_attempts: "Too many tries. Ask for a new code.",
};

function bucketOf(req: Request, did: string): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  return `${fwd || req.headers.get("x-real-ip") || "anon"}|${did}`;
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

  const result = (await authStore()).redeemCode(did, code, bucketOf(req, did));
  if (!result.ok) {
    return NextResponse.json({ error: MESSAGE[result.reason] ?? MESSAGE.unknown }, { status: 401 });
  }

  /* A worker's grant redeemed here mints a worker session, and a worker
     session is not a console session — so this would fail at the door anyway.
     Refusing it explicitly means the refusal is legible rather than emergent. */
  if (result.kind !== "operator") {
    return NextResponse.json({ error: "That code is not a console code." }, { status: 401 });
  }

  const who = operator(result.did);
  if (!who) return NextResponse.json({ error: "That code is not right." }, { status: 401 });

  const res = NextResponse.json({
    signedIn: true,
    operator: { did: who.did, name: who.name, role: who.role },
  });
  setSessionCookie(res, req, result.session.secret);

  (await eventStore()).append(ORG, {
    type: "auth.signed_in",
    at: new Date().toISOString(),
    actor: who.name,
    actorDid: who.did,
    subject: who.did,
    summary: `${who.name} signed in to the console`,
    data: { via: "console", sessionId: result.session.id },
  });

  return res;
}
