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
   agree, correctly, about the wrong tree. An install exiting 0 is
   not evidence either: exit 0 was true the entire time the two
   disagreed.

   Three decisions worth keeping.

   It compares against the LOCKFILE, not package.json. A range is
   satisfied by many versions; the lockfile names one. "Satisfies
   package.json" is the weaker claim and is how these drifted — the
   upgrade briefly landed as ^15.5.25, under which a stale 15.1.6
   is out of range but a newer 15.x would have passed.

   The package list is READ from package.json rather than written
   here. An enumerated list is correct the day it is typed and
   silently wrong the first time somebody adds a dependency. Nothing
   about this failure was specific to Next; it was specific to
   nobody looking.

   And versions are read from the PATH the lockfile names, not
   through module resolution. A package whose "exports" map does
   not expose ./package.json is unresolvable that way while being
   perfectly well installed — which the first version of this file
   reported as missing, for two packages the suite uses constantly.
   The lockfile's keys are paths. Use them.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

/** Every dependency this repo declares directly. A transitive drifting inside
    its range is npm working as intended; a direct one is not. */
const DIRECT = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort();

describe("the installed tree matches the lockfile", () => {
  it.each(DIRECT)("%s", (name) => {
    const pinned = lock.packages[`node_modules/${name}`]?.version;
    expect(pinned, `${name} is declared but absent from package-lock.json`).toBeDefined();

    const manifest = `node_modules/${name}/package.json`;
    expect(
      existsSync(manifest),
      `${name} is in the lockfile at ${pinned} but ${manifest} does not exist. Run npm ci.`,
    ).toBe(true);

    const installed = JSON.parse(readFileSync(manifest, "utf8")).version as string;

    expect(
      installed,
      `${name} is ${installed} on disk but the lockfile pins ${pinned}. ` +
        `A pull has outrun an install — run npm ci. Until then every check in ` +
        `this repo is measuring ${installed}, and passing.`,
    ).toBe(pinned);
  });

  it("is actually reading a manifest and a lockfile", () => {
    /* Guards the whole file. An empty DIRECT would make it.each register no
       cases at all, and the suite would report green having checked nothing —
       which is the failure this repo files under "a check with nothing to
       say", and worth not committing inside the check written to catch its
       cousin. */
    expect(DIRECT.length).toBeGreaterThan(10);
    expect(Object.keys(lock.packages ?? {}).length).toBeGreaterThan(50);
  });
});
