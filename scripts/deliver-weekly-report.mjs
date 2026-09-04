#!/usr/bin/env node
/* ============================================================
   Deliver last week's break-loading report to payroll.

   This is the thing a scheduler runs. The schedule deliberately does
   not live inside the app: an in-process timer dies with the process,
   fires twice if the process is restarted twice, and cannot be tested
   without waiting. Task Scheduler and cron already solve that, and
   they report failure to someone.

   It POSTs to the running app, which builds the report, writes the CSV
   into REPORTS_DIR and records the delivery — including the sha-256 of
   exactly what was written — in the audit chain.

   Re-running a week that has not changed delivers nothing and records
   nothing, so a retry, a double-fire or an operator running it by hand
   is safe.

   Usage:
     node scripts/deliver-weekly-report.mjs
     node scripts/deliver-weekly-report.mjs --dry-run
     node scripts/deliver-weekly-report.mjs --url=http://localhost:3000

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
const dryRun = Boolean(args["dry-run"]);

const fail = (msg) => {
  console.error(`covers: ${msg}`);
  process.exit(1);
};

if (!token) fail("REPORTS_RUN_TOKEN is not set — see .env.example");

const url = `${base}/api/reports/weekly/run${dryRun ? "?dryRun=1" : ""}`;

let res;
try {
  res = await fetch(url, { method: "POST", headers: { "x-run-token": token } });
} catch (e) {
  // the app being down is the ordinary failure here, and it must be loud:
  // a delivery that silently did not happen is worse than one that errored
  fail(`could not reach ${base} — is the app running? (${e.message})`);
}

const body = await res.json().catch(() => ({}));

if (res.status === 404) {
  fail("rejected — REPORTS_RUN_TOKEN does not match the app's");
}
if (!res.ok) {
  fail(`run failed (${res.status}) — ${body.error ?? "no detail"}`);
}

const { week, filename, target, contentHash, bytes, delivered, totals } = body;
const money = totals?.pricedAud > 0 ? `, $${totals.pricedAud.toFixed(2)}` : "";
const figures = `${totals?.breaches ?? 0} breaches, ${(totals?.loadingHours ?? 0).toFixed(2)} loading hours${money}`;

if (!delivered) {
  console.log(`covers: ${week?.label} already delivered — ${filename} unchanged (${figures})`);
} else if (dryRun) {
  console.log(`covers: ${week?.label} would deliver ${filename} — ${bytes} bytes, ${figures}`);
} else {
  console.log(`covers: ${week?.label} delivered to ${target} — ${bytes} bytes, ${figures}`);
  console.log(`covers: sha256 ${contentHash}`);
}

if (totals?.unpricedRows > 0) {
  // hours are always right; dollars need pay_rates.read, and a payroll
  // officer reading a short total should be told it is short
  console.log(
    `covers: ${totals.unpricedRows} row(s) have no rate — ${totals.unpricedHours.toFixed(2)} hours unpriced`,
  );
}
if (body.openShifts > 0) {
  console.log(`covers: ${body.openShifts} shift(s) still open at week end and not yet assessable`);
}
