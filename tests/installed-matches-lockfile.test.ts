/* ============================================================
   What is installed is what the lockfile says.

   A pull can outrun an install, and nothing tells you. Main took
   Next 15.1.6 → 15.5.25 as a security upgrade; a checkout that
   pulled it without reinstalling had package.json saying 15.5.25
   and node_modules holding 15.1.6. `next build` ran, the suite
   passed, and both were measuring the version the upgrade existed
   to replace.

   No tool reports this. npm does not check on demand, Next does
   not announce its own version, and every check in this repo runs
   against whatever happens to be in node_modules — so they all
   agree, correctly, about the wrong tree.

   This compares the installed version against the LOCKFILE rather
   than against package.json, deliberately. package.json may carry
   a range, and a range is satisfied by many versions; the lockfile
   names one. "Satisfies package.json" is the weaker claim and is
   exactly how these two drifted apart.

   It fails until somebody runs `npm ci`, which is the point: the
   window where a stale tree is invisible is the window this closes.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

/**
 * The packages worth pinning a check to.
 *
 * Not every dependency — a transitive that drifts inside its range is npm
 * working as intended. These are the ones where a silent mismatch changes what
 * ships: the framework that builds the app, the runtime it renders with, and
 * the runner that decides whether any of the other checks meant anything.
 */
const WATCHED = ["next", "react", "react-dom", "vitest"];

describe("the installed tree matches the lockfile", () => {
  it.each(WATCHED)("%s", (name) => {
    const entry = lock.packages[`node_modules/${name}`];
    expect(entry, `${name} is not in package-lock.json`).toBeDefined();

    const installed = require_(`${name}/package.json`).version as string;

    expect(
      installed,
      `${name} is ${installed} on disk but the lockfile pins ${entry.version}. ` +
        `A pull has outrun an install — run \`npm ci\`. Until then every check ` +
        `in this repo is measuring ${installed}, and passing.`,
    ).toBe(entry.version);
  });

  it("reads a lockfile that actually pins things", () => {
    // guards the whole file: a lockfile shape change that emptied `packages`
    // would make every case above vacuously pass
    expect(Object.keys(lock.packages ?? {}).length).toBeGreaterThan(50);
    for (const name of WATCHED) {
      expect(lock.packages[`node_modules/${name}`]?.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});
