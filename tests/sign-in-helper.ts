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
  const grant = authStore().issue(did);
  const result = authStore().redeemCode(did, grant.code, "test");
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
