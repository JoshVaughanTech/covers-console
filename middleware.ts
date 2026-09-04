import { NextResponse, type NextRequest } from "next/server";
import { COOKIE } from "@/lib/auth/cookie";

/* ============================================================
   The console door.

   Enforced in every environment. No "development means signed in":
   that infers authority from an environment that failed to say
   otherwise, which is the exact shape of the bug that had this
   server handing out sign-in codes to anyone who asked. What makes
   it bearable on a laptop is not an exemption, it is that the
   bootstrap is cheap — the code goes to a file the developer owns.

   This checks only for the PRESENCE of a session cookie, and that is
   deliberate rather than lazy. Middleware runs on the edge runtime,
   where node:sqlite does not exist, so it cannot resolve the session
   or read its kind. Treating presence as proof would make a worker's
   phone cookie a console pass.

   So this is a redirect, not a gate: it sends people who are plainly
   signed out to the sign-in page instead of showing them a console
   that will not load. Every route that does anything calls
   operatorOf(), which resolves the session properly and checks the
   kind. If this file were deleted tomorrow, nothing would become
   authorised — the pages would simply be uglier about refusing.

   Worth stating because the opposite arrangement is common and
   wrong: a middleware that authorises, and routes that trust it.
   ============================================================ */

export function middleware(req: NextRequest) {
  if (req.cookies.has(COOKIE)) return NextResponse.next();

  const to = new URL("/console-sign-in", req.url);
  // so the sign-in can put them back where they were going
  to.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(to);
}

export const config = {
  /*
     Console pages only.

     Not /m — the phone has its own sign-in and its own kind of session, and
     redirecting a worker to the console door would be both wrong and
     confusing. Not /api — those routes answer 401 in their own terms, which a
     fetch can act on and a redirect cannot. Not the sign-in page itself, for
     obvious reasons.
  */
  matcher: [
    "/overview/:path*",
    "/schedule/:path*",
    "/events/:path*",
    "/open-shifts/:path*",
    "/attendance/:path*",
    "/breaks/:path*",
    "/projects/:path*",
    "/people/:path*",
    "/comms/:path*",
    "/credentials/:path*",
    "/audit/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/sign-in-codes/:path*",
  ],
};
