/* ============================================================
   Reading the session off a request.

   One function, because the value of it is that no route decides for
   itself who is calling. Before this, /api/shifts took a did from the
   query string and believed it — which is not a weak session, it is
   the absence of one: any phone could ask for anybody's board and put
   anybody's hand up.

   The cookie is HttpOnly so page scripts cannot read it, SameSite=Lax
   so another site cannot make the browser spend it, and Secure
   whenever the request arrived over TLS. It is deliberately not
   Secure unconditionally: this app gets served over plain http on a
   venue LAN so a phone can reach it, and a Secure cookie there is
   silently dropped — a sign-in that appears to work and does not.
   ============================================================ */
import type { NextResponse } from "next/server";
import { authStore } from "@/lib/store/auth";
import { SESSION_TTL_SECONDS } from "./token";
import { WORKERS } from "@/lib/idara/seed";
import type { Identity } from "@/lib/idara/types";

export const COOKIE = "covers_session";

export interface Caller {
  did: string;
  person: Identity;
  sessionId: string;
}

const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));

/** Whoever is making this request, or null if nobody is. */
export function callerOf(req: Request): Caller | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;

  const secret = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!secret) return null;

  const session = authStore().resolve(decodeURIComponent(secret));
  if (!session) return null;

  const person = workerIndex.get(session.did);
  // a session for somebody who is no longer on the books is not a session;
  // failing closed here means removing a worker also signs their phone out
  if (!person) return null;

  return { did: session.did, person, sessionId: session.id };
}

/** True when this request reached us over TLS, directly or via a proxy. */
function isSecure(req: Request): boolean {
  if (req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https") return true;
  return new URL(req.url).protocol === "https:";
}

export function setSessionCookie(res: NextResponse, req: Request, secret: string): void {
  res.cookies.set({
    name: COOKIE,
    value: secret,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(req),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse, req: Request): void {
  res.cookies.set({
    name: COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(req),
    path: "/",
    maxAge: 0,
  });
}

/** The cookie value on a request, for signing out the session it names. */
export function secretOf(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  const v = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return v ? decodeURIComponent(v) : null;
}
