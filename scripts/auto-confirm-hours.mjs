#!/usr/bin/env node
/* ============================================================
   Confirm hours the venue has not disputed within 48 hours.

   The rule is §5's: a worker should not be left unpaid because a
   manager was on holiday. After two days the clock's numbers stand
   on their own, and this is what makes that true rather than
   aspirational.

   The schedule lives outside the app, for the reasons the weekly
   report already gives: an in-process timer dies with the process,
   fires twice if the process is restarted twice, and cannot be
   tested without waiting. Task Scheduler and cron already solve
   that, and they report failure to someone.

   Safe to run as often as you like. Each confirmation is keyed on
   its engagement, so a double-fire, a retry, or an operator running
   it by hand writes nothing the first run already wrote. Running it
   hourly is fine; the 48-hour window is what decides, not the
   cadence.

   Deliberately NOT run on a read. Confirming bills somebody, and a
   GET that quietly invoices a venue because a page was open is the
   kind of side effect nobody goes looking for.

   Usage:
     node scripts/auto-confirm-hours.mjs
     node scripts/auto-confirm-hours.mjs --url=http://localhost:3000

   Reads REPORTS_RUN_TOKEN, and COVERS_URL for the app's address.
   Exits non-zero on failure, which is how the scheduler notices.
   ============================================================ */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.length ? rest.join("=") : true];
  }),
);

const base = (args.url ?? process.env.COVERS_URL ?? "http://localhost:3000").replace(/\/$/, "");
const token = args.token ?? process.env.REPORTS_RUN_TOKEN;

const fail = (msg) => {
  console.error(`covers: ${msg}`);
  process.exit(1);
};

if (!token) fail("REPORTS_RUN_TOKEN is not set, so the sweep cannot authenticate");

const res = await fetch(`${base}/api/engagements/confirm`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-run-token": token },
  body: "{}",
}).catch((e) => fail(`could not reach ${base}: ${e.message}`));

const body = await res.json().catch(() => ({}));

if (!res.ok) fail(`${res.status} ${body.error ?? "the sweep failed"}`);

/* Nothing due is the normal outcome and is reported as success. A scheduler
   that treated a quiet night as a failure would be turned off within a week. */
const n = body.confirmed ?? 0;
if (n === 0) {
  console.log("covers: nothing past its 48-hour window");
} else {
  console.log(
    `covers: auto-confirmed ${n} shift${n === 1 ? "" : "s"}` +
      (body.results ?? []).map((r) => `\n  ${r.engagementId}  ${r.hours}h`).join(""),
  );
}

/* Said plainly, because it changes what the numbers above mean: with no
   Connecteam credentials the app serves seeded sessions, and a sweep run
   against those would be confirming demo hours as somebody's worked hours. */
if (body.clockLive === false) {
  console.log("covers: NOTE — no time clock configured, so these came from the demo seed");
}
