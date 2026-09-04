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

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token) return NextResponse.redirect(new URL("/m?signin=missing", url.origin));

  const result = authStore().redeemToken(token);
  if (!result.ok) {
    return NextResponse.redirect(new URL(`/m?signin=${result.reason}`, url.origin));
  }

  const person = workerIndex.get(result.did);
  const res = NextResponse.redirect(new URL("/m/shifts", url.origin));
  setSessionCookie(res, req, result.session.secret);

  eventStore().append(ORG, {
    type: "auth.signed_in",
    at: new Date().toISOString(),
    actor: person?.name ?? result.did,
    actorDid: result.did,
    subject: result.did,
    summary: `${person?.name ?? result.did} signed in on a device`,
    data: { via: "link", sessionId: result.session.id },
  });

  return res;
}
