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
import { operator, type Operator } from "./operators";

export { COOKIE } from "./cookie";
import { COOKIE } from "./cookie";

/**
 * Whoever is making this request, in the terms the caller must commit to.
 *
 * There is deliberately no callerOf(). A single function returning a session
 * with a kind on it would let every existing call site keep treating "a
 * session resolved" as sufficient, and the day the console authorised on that
 * test, every worker's phone session would authorise the console. The field
 * would have been added correctly and then not consulted, which looks
 * identical to correct code in review.
 *
 * So the split is at the function, not at a property: a route asks for the
 * kind it accepts and gets null for anything else. Adding operators broke
 * every existing call site until it said which it wanted, which is the point.
 */
export interface WorkerCaller {
  kind: "worker";
  did: string;
  person: Identity;
  sessionId: string;
}

export interface OperatorCaller {
  kind: "operator";
  did: string;
  operator: Operator;
  sessionId: string;
}

const workerIndex = new Map(WORKERS.map((w) => [w.did, w]));

/** The session secret on a request, if there is one. */
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

/** The worker making this request, or null. An operator session is not one. */
export function workerOf(req: Request): WorkerCaller | null {
  const secret = secretOf(req);
  if (!secret) return null;

  const session = authStore().resolve(secret);
  if (!session || session.kind !== "worker") return null;

  const person = workerIndex.get(session.did);
  // a session for somebody no longer on the books is not a session; failing
  // closed here means removing a worker also signs their phone out
  if (!person) return null;

  return { kind: "worker", did: session.did, person, sessionId: session.id };
}

/** The operator making this request, or null. A worker session is not one. */
export function operatorOf(req: Request): OperatorCaller | null {
  const secret = secretOf(req);
  if (!secret) return null;

  const session = authStore().resolve(secret);
  if (!session || session.kind !== "operator") return null;

  const who = operator(session.did);
  // removed from the roster is removed from the console, on the next request
  if (!who) return null;

  return { kind: "operator", did: session.did, operator: who, sessionId: session.id };
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
