#!/usr/bin/env node
/* ============================================================
   Break the code on purpose and see whether the suite notices.

   A passing test is not evidence that anything is guarded. It is
   evidence that the assertion it contains was satisfied, which is
   a different claim and the one docs/green-tests-broken-build.md
   spends a section on. The only way to tell them apart is to
   remove the behaviour and watch what goes red.

   This found something six existing tests missed. The award floor
   refusal names the dearest underpaid band so a manager knows what
   to fix; pointing it at the CHEAPEST underpaid band instead broke
   nothing, because the figure the tests matched on — $40.62 —
   appears twice in that sentence, and the second occurrence is
   computed separately and stayed right. Every assertion passed on
   the coincidence.

   Deliberately not part of `npm test`, and not in CI:

     - it edits tracked source files, which no test should
     - it is slow, because each mutation is a suite run
     - a mutation that survives is a prompt to think, not a build
       failure. Failing CI on one would turn "this deserves a
       look" into "delete the mutation", which is the opposite of
       the point.

   Run it when you change a guard, or when you are about to trust
   a test you did not write.

   Usage:
     npm run mutate                 every mutation
     npm run mutate -- --only=M4    one, by id
     npm run mutate -- --list       names only, runs nothing

   Exit code is 0 when every mutation was killed, 1 when any
   survived, and 2 when the tree was left dirty — see below.
   ============================================================ */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

/* ------------------------------------------------------------
   The mutations.

   Each one is a plausible mistake rather than random noise: an
   inverted condition, a dropped guard, an off-by-one into the
   wrong end of a sorted array. `guards` names the suites that
   claim to cover it, so a run is seconds rather than minutes —
   and so a mutation surviving names the file that should have
   caught it.
   ------------------------------------------------------------ */
const MUTATIONS = [
  {
    id: "M1",
    what: "buildPosting stops pushing the underpay error",
    file: "lib/shifts/draft.ts",
    from: "    if (underpaying) errors.push(underpaying);",
    to: "    if (false && underpaying) errors.push(underpaying);",
    guards: ["tests/post-shift-api.test.ts", "tests/posting.test.ts"],
  },
  {
    id: "M2",
    what: "the floor is checked on publish but not on a draft",
    file: "lib/shifts/draft.ts",
    from: "    if (underpaying) errors.push(underpaying);",
    to: "    if (underpaying && d.publish) errors.push(underpaying);",
    guards: ["tests/post-shift-api.test.ts", "tests/shift-pay.test.ts"],
  },
  {
    id: "M3",
    what: "payBlockReasonFor allows everything",
    file: "lib/shifts/pay.ts",
    from: "  if (a.atOrAboveFloor) return null;",
    to: "  if (true) return null;",
    guards: ["tests/shift-pay.test.ts", "tests/post-shift-api.test.ts"],
  },
  {
    id: "M4",
    what: "the refusal names the cheapest underpaid band, not the dearest",
    file: "lib/shifts/pay.ts",
    from: "  const worst = a.shortSegments[0];",
    to: "  const worst = a.shortSegments[a.shortSegments.length - 1];",
    guards: ["tests/shift-pay.test.ts"],
    /* Survived until #60. The gate still refused; only the explanation was
       wrong, and a wrong explanation sends a manager to raise the wrong rate. */
  },
  {
    id: "M5",
    what: "a shift outside the rate table's dates stops being refused",
    file: "lib/shifts/pay.ts",
    from: "    if (e instanceof RateTableRangeError) return e.message;",
    to: "    if (e instanceof RateTableRangeError) return null;",
    guards: ["tests/shift-pay.test.ts", "tests/rates.test.ts"],
  },
  {
    id: "M6",
    what: "payBlockReason treats every posting as checked",
    file: "lib/shifts/pay.ts",
    from: "  return posting.pay ? payBlockReasonFor(posting.pay) : null;",
    to: "  return null;",
    guards: ["tests/shift-pay.test.ts", "tests/post-shift-api.test.ts"],
  },
  {
    id: "M7",
    what: "the publish receipt is written before its reasons, not after",
    file: "lib/idara/publish.ts",
    from: "  return events;",
    to: "  return events.reverse();",
    guards: ["tests/publish-receipt.test.ts"],
  },
  {
    id: "M9",
    what: "the rate preview quotes the smallest shortfall, not the binding one",
    file: "lib/awards/rates.ts",
    from: "  const worst = shortSegments[0];",
    to: "  const worst = shortSegments[shortSegments.length - 1];",
    guards: ["tests/rates.test.ts", "tests/shift-pay.test.ts", "tests/engagement.test.ts"],
    /* M4's twin, and the more consequential of the two. M4 left the "raise to
       at least" figure correct because it is computed separately; here the whole
       sentence comes from `worst`, including "short by $X/h". A manager typing a
       rate on /open-shifts reads this live, so understating the gap tells them
       to raise by an amount that will still be refused. */
  },
  {
    id: "M8",
    what: "the task fold re-adds a card already in the column it moved to",
    file: "lib/tasks/replay.ts",
    from: "    if (!from || from === to) continue;",
    to: "    if (!from) continue;",
    guards: ["tests/task-replay.test.ts"],
  },
];

/* ------------------------------------------------------------
   Running one
   ------------------------------------------------------------ */

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** Files this run will touch, so the tree can be checked before and after. */
const targets = () => [...new Set(MUTATIONS.map((m) => m.file))];

/**
 * Restore from git rather than from a copy taken at startup.
 *
 * A copy is one more thing that can be wrong — stale, half-written, or made
 * after the file was already mutated by an interrupted run. `git checkout --`
 * restores what is committed, which is the only definition of "unmutated" that
 * does not depend on this script having behaved.
 */
const restore = () => {
  try {
    execFileSync("git", ["checkout", "--", ...targets()], { stdio: "ignore" });
  } catch {
    /* reported by verifyClean below, which is what the exit code follows */
  }
};

const runSuites = (suites) => {
  const r = spawnSync("npx", ["vitest", "run", ...suites], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

/**
 * How many tests the mutation broke.
 *
 * ANSI has to come off first. vitest colours that line, and the escapes
 * themselves contain digits — \x1b[32m — so a \D* between "Tests" and the
 * number stops inside the escape and never reaches it. This reported
 * "? failing" for every killed mutation until the output was looked at with
 * `cat -v` rather than read.
 */
const failingCount = (out) => {
  const plain = out.replace(/\[[0-9;]*m/g, "");
  const m = plain.match(/Tests\s+(\d+)\s+failed/);
  return m ? m[1] : "?";
};

/* ------------------------------------------------------------
   The run
   ------------------------------------------------------------ */

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const list = args.includes("--list");

const chosen = only ? MUTATIONS.filter((m) => m.id === only) : MUTATIONS;
if (only && chosen.length === 0) {
  console.error(`No mutation called ${only}. Known: ${MUTATIONS.map((m) => m.id).join(", ")}`);
  process.exit(2);
}

if (list) {
  for (const m of MUTATIONS) console.log(`${m.id}  ${m.file}\n     ${m.what}`);
  process.exit(0);
}

/* A dirty target file would be restored to HEAD by this script and the work
   lost. Refusing is the only safe answer: there is no way to tell an edit
   somebody is in the middle of from a mutation an interrupted run left. */
const dirty = git("status", "--porcelain", "--", ...targets());
if (dirty) {
  console.error("Refusing to run: these files have uncommitted changes, and this");
  console.error("script restores them from HEAD.\n");
  console.error(dirty);
  console.error("\nCommit or stash them first.");
  process.exit(2);
}

process.on("SIGINT", () => {
  restore();
  console.error("\ninterrupted — files restored from HEAD");
  process.exit(2);
});

console.log(`Mutating ${chosen.length} guard${chosen.length === 1 ? "" : "s"}.\n`);

const baseline = runSuites([...new Set(chosen.flatMap((m) => m.guards))]);
if (baseline.code !== 0) {
  console.error("The suite is already red. Fix that first — a mutation run over a");
  console.error("failing baseline cannot tell you which failure is yours.");
  process.exit(2);
}
console.log("baseline: green\n");

const survivors = [];
for (const m of chosen) {
  const before = readFileSync(m.file, "utf8");
  if (!before.includes(m.from)) {
    console.log(`${m.id}  STALE — the code it mutates has changed`);
    console.log(`      ${m.file} no longer contains the line this expects.`);
    console.log(`      Update or delete this mutation; it is guarding nothing.\n`);
    survivors.push({ ...m, stale: true });
    continue;
  }

  writeFileSync(m.file, before.replace(m.from, m.to), "utf8");
  const { code, out } = runSuites(m.guards);
  restore();

  if (code === 0) {
    survivors.push(m);
    console.log(`${m.id}  SURVIVED  ${m.what}`);
    console.log(`      nothing in ${m.guards.join(", ")} noticed.\n`);
  } else {
    console.log(`${m.id}  killed (${failingCount(out)} failing)  ${m.what}\n`);
  }
}

/* Whatever happened above, the tree has to be as it was found. */
restore();
const stillDirty = git("status", "--porcelain", "--", ...targets());
if (stillDirty) {
  console.error("\nTHE TREE IS STILL MUTATED — restore failed:\n");
  console.error(stillDirty);
  console.error("\nRun: git checkout -- " + targets().join(" "));
  process.exit(2);
}

if (survivors.length === 0) {
  console.log(`All ${chosen.length} killed. Every guard here is doing something.`);
  process.exit(0);
}

console.log(`\n${survivors.length} of ${chosen.length} survived.\n`);
console.log("A survivor is not a build failure. It is one of three things, and");
console.log("they want different answers:");
console.log("  - the behaviour is untested        → write the test");
console.log("  - the test asserts something else  → the M4 case: an assertion");
console.log("    satisfied by a coincidence reads exactly like one that is not");
console.log("  - the mutation is not a real bug   → delete it, and say why");
process.exit(1);
