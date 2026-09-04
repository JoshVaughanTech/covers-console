import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /* Where the build writes. Unset, this is Next's own default and nothing
     changes; set, it lets a build run without touching the .next a dev server
     is using.

     Three sessions share this checkout, and a build writing .next underneath a
     running dev server produced a PageNotFoundError for /_document that reads
     like a broken app and is not one. The sharper reason is quieter:
     tsconfig.json pulls in the route types Next generates under .next, so
     one shared .next feeds them into everybody's tsc at once — see entry 6 of
     docs/green-tests-broken-build.md, where stale ones reported errors in a
     route that no longer existed.

     One catch, because it bites once and is invisible afterwards: building
     with this set makes Next add the new types directory to tsconfig.json, and
     reformat the file while it is there. That is a shared file. So build in a
     throwaway copy of the tree, or check git diff on tsconfig.json afterwards
     and revert it. */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
