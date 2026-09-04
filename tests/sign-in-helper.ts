import { authStore } from "../lib/store/auth";
import { COOKIE } from "../lib/auth/session";

/* Signing a test caller in.

   Goes through the real grant and redemption rather than forging a cookie,
   so a test that passes is evidence the actual sign-in path works. A helper
   that minted its own session would keep passing after the route stopped
   issuing one. */

export interface TestSession {
  did: string;
  cookie: string;
}

export function signIn(did: string): TestSession {
  const issued = authStore().issue(did, "worker");
  if (!issued.ok) throw new Error("test sign-in could not get a code: rate limited");
  const result = authStore().redeemCode(did, issued.grant.code, "test");
  if (!result.ok) throw new Error(`test sign-in failed: ${result.reason}`);
  return { did, cookie: `${COOKIE}=${encodeURIComponent(result.session.secret)}` };
}

/** A Request carrying a session, the way a signed-in phone would send it. */
export function asCaller(session: TestSession, url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", session.cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}

/**
 * An operator session, minted the same way a worker's is.
 *
 * Goes through issue() and redeemCode() rather than writing a session row, so
 * a test that passes is evidence the kind really is carried from the grant to
 * the session. A helper that forged the row would keep passing on the day that
 * stopped being true, which is the one thing these tests exist to catch.
 */
export function signInOperator(did: string): TestSession {
  const issued = authStore().issue(did, "operator");
  if (!issued.ok) throw new Error("test operator sign-in could not get a code: rate limited");
  const result = authStore().redeemCode(did, issued.grant.code, "test");
  if (!result.ok) throw new Error(`test operator sign-in failed: ${result.reason}`);
  if (result.kind !== "operator") throw new Error("grant did not carry the operator kind");
  return { did, cookie: `${COOKIE}=${encodeURIComponent(result.session.secret)}` };
}
