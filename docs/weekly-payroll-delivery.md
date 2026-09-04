# Getting the break-loading report to payroll every week

**Date:** 2026-09-04 · **Status:** operating note

The report has existed since the breaks board shipped. Someone had to open the
console, pick the week and click Export — which works right up to the week
nobody remembers. This is that step done on a timer.

Every Monday morning, last week's Monday–Sunday CSV is written into a folder
payroll already opens, and the delivery is recorded in the audit chain with the
sha-256 of exactly what was written.

---

## What it produces

One file per venue per week:

```
break-loading_brightwater-hotel_2025-08-25_2025-08-31.csv
```

Same content as the Export button — one row per breach, the clause it comes
from, hours owed at the 50% loading, and dollars where a rate is known.

## Setting it up

Two variables in `.env`:

```
REPORTS_DIR=D:\Payroll\Break Loading
REPORTS_RUN_TOKEN=<a long random string>
```

Generate the token with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`REPORTS_DIR` is any folder the app's account can write to. A synced drive or a
mapped share means payroll never touches this console at all — the file simply
appears where they already look.

Check it end to end without writing anything:

```bash
npm run report:weekly -- --dry-run
```

Then for real:

```bash
npm run report:weekly
```

## Putting it on the timer

The schedule lives outside the app, in whatever already runs on a timer. An
in-process timer would die with the process, fire twice if the process were
restarted twice, and could not be tested without waiting.

**Windows** — Task Scheduler, Mondays at 07:00:

```bash
schtasks /Create /TN "Covers weekly break loading" /SC WEEKLY /D MON /ST 07:00 /TR "cmd /c cd /d C:\covers && npm run report:weekly >> logs\report.log 2>&1"
```

**Linux or macOS** — crontab:

```bash
0 7 * * 1 cd /srv/covers && npm run report:weekly >> logs/report.log 2>&1
```

The script exits non-zero when the app is unreachable, the token is wrong or
the run fails, which is how the scheduler notices. A delivery that silently did
not happen is worse than one that errored.

## Running it twice

Safe, and deliberately so. A scheduler that fires on restart, a retried job, an
operator clicking again — none of them produce a second file or a second
delivery record. The run compares what it would write against what is already
there and stops if they match, and the audit append is keyed by venue and week.

Payroll receiving the same figures twice is confusing. An audit chain claiming
two deliveries of one report is worse, because it is false.

If the figures *do* change — a late punch correction, a rate that arrived — the
file is rewritten with the corrected numbers.

## What the audit chain records

A `report.delivered` event per week, carrying the week, the venue, the
filename, the totals, and the sha-256 of the delivered bytes. That last part is
what turns "we sent payroll a report" into "we sent payroll *this* report",
which is the form the claim needs to be in if it is ever disputed.

A scheduled run is recorded as `system` with `trigger: "schedule"` — a schedule
is not a person and does not get an invented identity. A person who sends it by
hand is recorded by name *and* by DID, because two people with the same display
name are indistinguishable in a log that only holds names.

## The endpoint

`POST /api/reports/weekly/run`, authenticated with `x-run-token`.

It answers **404** to a missing or wrong token rather than 401, so an
unauthenticated caller learns nothing about whether it exists. Unset,
`REPORTS_RUN_TOKEN` locks the door rather than removing it.

This matters more than it looks: the app is sometimes bound to `0.0.0.0` so a
phone on the venue Wi-Fi can reach `/m`. An open endpoint that writes files
would be reachable by everyone on that network.

## What it can't tell you yet

Dollars need the `pay_rates.read` scope on the Connecteam integration. Without
it the hours are still exact — they come from the award, not the payroll system
— and the dollar column is blank. The script says how many rows are unpriced
rather than quietly totalling a short number.

Shifts still open when the week ended are counted and reported separately; they
are not assessable until someone clocks out.
