/* ============================================================
   GET /api/auth/link?t=… — the magic link itself.

   Redeems and redirects, so the secret is spent by the navigation
   rather than sitting in the address bar of a phone that gets handed
   round. The redirect target carries no secret for the same reason.

   A failure redirects to the sign-in screen with a reason rather
   than rendering an error page: somebody who clicked a stale link
   wants the way back in, not a status code.
   ============================================================ */
import { NextResponse } from "next/server";
import { authStore } from "@/lib/store/auth";
import { eventStore } from "@/lib/store/events";
import { setSessionCookie } from "@/lib/auth/session";
import { WORKERS } from "@/lib/idara/seed";
import { operator } from "@/lib/auth/operators";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token) return NextResponse.redirect(new URL("/m?signin=missing", url.origin));

  const result = await (await authStore()).redeemToken(token);
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/m?signin=${result.reason}`, url.origin));
  }

  /* Where the link lands follows the kind of session it minted. An operator
     sent to /m/shifts arrives somewhere their session cannot do anything —
     not unsafe, because the kind still refuses everything there, but a dead
     end that reads as the link being broken. */
  const isOperator = result.kind === "operator";
  const who = isOperator ? operator(result.did) : undefined;
  const person = workerIndex.get(result.did);
  const name = who?.name ?? person?.name ?? result.did;

  const res = NextResponse.redirect(new URL(isOperator ? "/overview" : "/m/shifts", url.origin));
  setSessionCookie(res, req, result.session.secret);

  await (await eventStore()).append(ORG, {
    type: "auth.signed_in",
    at: new Date().toISOString(),
    actor: name,
    actorDid: result.did,
    subject: result.did,
    summary: `${name} signed in ${isOperator ? "to the console" : "on a device"}`,
    data: { via: "link", kind: result.kind, sessionId: result.session.id },
  });

  return res;
}
