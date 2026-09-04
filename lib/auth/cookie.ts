/* ============================================================
   The session cookie's name, and nothing else.

   Its own module because middleware needs it and middleware runs on
   the edge runtime, where node:sqlite and node:crypto do not exist.
   Importing it from lib/auth/session.ts pulled the whole auth store
   into that bundle and the build refused — correctly, and only at
   build time: tsc and eslint were both silent, because nothing about
   the types is wrong.

   A constant with no dependencies is the fix. Keeping it here also
   means the middleware cannot casually start using anything that
   resolves a session, which it must not: it can check that a cookie
   is present and nothing more.
   ============================================================ */

export const COOKIE = "covers_session";
