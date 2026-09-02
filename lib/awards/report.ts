/* ============================================================
   Weekly missed-break loading report — HIGA cl 16.6.

   The payroll counterpart to the Break Compliance board. /breaks
   says who is about to cost 50% loading; this says what the week
   already cost, per person, per shift, with the clause attached.

   No new award logic and no persistence: assess() already handles
   closed shifts, so this is a pure fold over a week of sessions.
   Because every shift in a past week has clockOut set, `end` is
   clockOut and `now` cannot influence the result — folding the same
   week twice yields identical output, which is what makes the
   figures safe to hand to payroll.
   ============================================================ */
import { HIGA, assess, type ShiftSession, type BreakAssessment, type AlertCode } from "./higa";

const H = 3600;

/** The only two codes that carry money. Rest shortfalls (16.7) never do. */
const LOADING_CODES: AlertCode[] = ["MEAL_MISSED", "MEAL_LATE_HISTORIC"];

export type LoadingCode = "MEAL_MISSED" | "MEAL_LATE_HISTORIC";

/** One breach on one shift. A row is a breach, not a shift. */
export interface BreachRow {
  userId: string;
  name: string;
  role: string;
  siteName: string;
  /** local YYYY-MM-DD, assigned by clock-in — a close shift belongs to the day it started. */
  shiftDate: string;
  clockIn: number;
  clockOut: number;
  hoursWorked: number;
  code: LoadingCode;
  clause: string;
  /** human-readable window the loading covers, e.g. "19:53–21:53" */
  window: string;
  loadingSec: number;
  loadingHours: number;
  hourlyRate: number | null;
  /** null when no rate is known — never estimated. */
  loadingAud: number | null;
}

export interface PersonTotal {
  userId: string;
  name: string;
  role: string;
  siteName: string;
  breaches: number;
  loadingHours: number;
  /** null when every one of this person's rows is unpriced. */
  loadingAud: number | null;
  unpricedRows: number;
}

export interface SiteTotal {
  siteName: string;
  breaches: number;
  loadingHours: number;
  loadingAud: number;
  unpricedRows: number;
}

export interface ReportTotals {
  shiftsAssessed: number;
  breaches: number;
  /** every row, priced or not */
  loadingHours: number;
  /** priced rows only — unpriced loading is never converted into this */
  pricedAud: number;
  pricedRows: number;
  unpricedRows: number;
  unpricedHours: number;
}

export interface WeeklyBreakReport {
  awardId: string;
  awardLabel: string;
  consolidatedTo: string;
  weekStart: number;
  weekEnd: number;
  /** "w/e 6 Sep 2026" */
  weekLabel: string;
  siteName: string | null;
  rows: BreachRow[];
  byPerson: PersonTotal[];
  bySite: SiteTotal[];
  totals: ReportTotals;
  /** clocked in during the week and never clocked out — excluded, not ignored. */
  openShifts: number;
}

export interface ReportOptions {
  timezone?: string;
  /** restrict to one venue; omitted means every site in the data. */
  siteName?: string | null;
}

const TZ = "Australia/Melbourne";

/** local YYYY-MM-DD for an epoch second, in the venue's timezone. */
export function localDate(ts: number, tz = TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function clockLabel(ts: number, tz = TZ): string {
  return new Date(ts * 1000).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  });
}

/** "w/e 6 Sep 2026" — the week is named for the day it ends. */
export function weekLabel(weekEnd: number, tz = TZ): string {
  const d = new Date((weekEnd - 1) * 1000).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: tz,
  });
  return `w/e ${d}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Seconds the venue wall clock is ahead of UTC at this instant. */
function tzOffsetSec(ts: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts * 1000));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) / 1000 - ts;
}

/** Epoch seconds of local midnight opening the day that contains `ts`. */
export function localMidnight(ts: number, tz = TZ): number {
  const naive = Date.parse(`${localDate(ts, tz)}T00:00:00Z`) / 1000;
  // resolve the offset, then re-resolve at the result in case midnight sits the
  // other side of a DST transition from the naive guess
  return naive - tzOffsetSec(naive - tzOffsetSec(naive, tz), tz);
}

/**
 * Monday 00:00 of the last *completed* week, in venue-local time — what payroll
 * processes on a Monday. Returns [start, end) as epoch seconds.
 *
 * Day arithmetic goes via midday before re-anchoring to midnight, so a DST
 * transition inside the week cannot shift a boundary by an hour.
 */
export function lastCompleteWeek(now: number, tz = TZ): { start: number; end: number } {
  const today = localDate(now, tz);
  // 0 = Sunday in getUTCDay terms; we want Monday-start weeks
  const daysSinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const midnight = localMidnight(now, tz);
  const thisMonday = localMidnight(midnight - (daysSinceMonday * 86400) + 43200, tz);
  return { start: localMidnight(thisMonday - 7 * 86400 + 43200, tz), end: thisMonday };
}

/** Does a session belong to this week? Decided by clock-in, so overnight shifts don't split. */
export function inWeek(s: ShiftSession, start: number, end: number): boolean {
  return s.clockIn >= start && s.clockIn < end;
}

function rowFrom(a: BreakAssessment, s: ShiftSession, tz: string): BreachRow | null {
  const alert = a.alerts.find((x) => LOADING_CODES.includes(x.code));
  if (!alert || !a.penalty || a.penalty.seconds <= 0) return null;
  const clockOut = s.clockOut as number;
  const p = a.penalty;
  return {
    userId: a.userId,
    name: a.name,
    role: a.role,
    siteName: a.siteName,
    shiftDate: localDate(s.clockIn, tz),
    clockIn: s.clockIn,
    clockOut,
    hoursWorked: round2((clockOut - s.clockIn) / H),
    code: alert.code as LoadingCode,
    clause: alert.clause,
    window: `${clockLabel(p.from, tz)}–${clockLabel(p.to ?? clockOut, tz)}`,
    loadingSec: p.seconds,
    loadingHours: round2(p.seconds / H),
    hourlyRate: s.ordinaryHourlyRate ?? null,
    loadingAud: p.estimateAud,
  };
}

/**
 * Fold a week of sessions into the payroll report.
 *
 * Open shifts are excluded rather than assessed — a shift with no clock-out has no
 * defensible end time, so costing it would invent loading. They are counted instead,
 * so the omission is visible on the artifact.
 */
export function weeklyReport(
  sessions: ShiftSession[],
  weekStart: number,
  weekEnd: number,
  opts: ReportOptions = {},
): WeeklyBreakReport {
  const tz = opts.timezone ?? TZ;
  const site = opts.siteName ?? null;

  const inScope = sessions
    .filter((s) => inWeek(s, weekStart, weekEnd))
    .filter((s) => !site || s.siteName === site);

  const open = inScope.filter((s) => s.clockOut == null);
  const closed = inScope.filter((s) => s.clockOut != null);

  const rows: BreachRow[] = [];
  for (const s of closed) {
    // now is irrelevant for a closed shift (end = clockOut), but pass the week end
    // so the call is explicit rather than relying on that invariant
    const row = rowFrom(assess(s, weekEnd, { timezone: tz }), s, tz);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => a.shiftDate.localeCompare(b.shiftDate) || a.name.localeCompare(b.name));

  const byPerson = [...groupBy(rows, (r) => r.userId).values()]
    .map((rs): PersonTotal => {
      const priced = rs.filter((r) => r.loadingAud != null);
      return {
        userId: rs[0].userId,
        name: rs[0].name,
        role: rs[0].role,
        siteName: rs[0].siteName,
        breaches: rs.length,
        loadingHours: round2(rs.reduce((a, r) => a + r.loadingHours, 0)),
        loadingAud: priced.length ? round2(priced.reduce((a, r) => a + (r.loadingAud as number), 0)) : null,
        unpricedRows: rs.length - priced.length,
      };
    })
    .sort((a, b) => (b.loadingAud ?? 0) - (a.loadingAud ?? 0) || b.loadingHours - a.loadingHours);

  const bySite = [...groupBy(rows, (r) => r.siteName).values()]
    .map((rs): SiteTotal => ({
      siteName: rs[0].siteName,
      breaches: rs.length,
      loadingHours: round2(rs.reduce((a, r) => a + r.loadingHours, 0)),
      loadingAud: round2(rs.reduce((a, r) => a + (r.loadingAud ?? 0), 0)),
      unpricedRows: rs.filter((r) => r.loadingAud == null).length,
    }))
    .sort((a, b) => b.loadingAud - a.loadingAud);

  const pricedRows = rows.filter((r) => r.loadingAud != null);
  const unpriced = rows.filter((r) => r.loadingAud == null);

  return {
    awardId: HIGA.awardId,
    awardLabel: HIGA.awardLabel,
    consolidatedTo: HIGA.consolidatedTo,
    weekStart,
    weekEnd,
    weekLabel: weekLabel(weekEnd, tz),
    siteName: site,
    rows,
    byPerson,
    bySite,
    totals: {
      shiftsAssessed: closed.length,
      breaches: rows.length,
      loadingHours: round2(rows.reduce((a, r) => a + r.loadingHours, 0)),
      pricedAud: round2(pricedRows.reduce((a, r) => a + (r.loadingAud as number), 0)),
      pricedRows: pricedRows.length,
      unpricedRows: unpriced.length,
      unpricedHours: round2(unpriced.reduce((a, r) => a + r.loadingHours, 0)),
    },
    openShifts: open.length,
  };
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const found = out.get(k);
    if (found) found.push(it);
    else out.set(k, [it]);
  }
  return out;
}

/* ---------- CSV ---------- */

/** RFC 4180: quote a field containing a comma, quote or newline, doubling its quotes. */
export function csvField(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = [
  "name",
  "role",
  "site",
  "shift_date",
  "clock_in",
  "clock_out",
  "hours",
  "breach",
  "clause",
  "loading_window",
  "loading_hrs",
  "rate_aud",
  "loading_aud",
];

/**
 * The file payroll receives, built from the same report object the screen renders so
 * the two cannot drift. Title and provenance ride above the header row, so a CSV
 * sitting in an inbox still says which award and consolidation produced it.
 */
export function reportToCsv(r: WeeklyBreakReport, tz = TZ): string {
  const title = `Break Loading — ${r.siteName ?? "All venues"} — ${r.weekLabel}`;
  const lines: string[] = [
    csvField(title),
    csvField(`${r.awardId} · ${r.awardLabel} · consolidated ${r.consolidatedTo}`),
    "",
    CSV_HEADER.join(","),
  ];

  for (const row of r.rows) {
    lines.push(
      [
        csvField(row.name),
        csvField(row.role),
        csvField(row.siteName),
        csvField(row.shiftDate),
        csvField(clockLabel(row.clockIn, tz)),
        csvField(clockLabel(row.clockOut, tz)),
        csvField(row.hoursWorked.toFixed(2)),
        csvField(row.code),
        csvField(row.clause),
        csvField(row.window),
        csvField(row.loadingHours.toFixed(2)),
        csvField(row.hourlyRate != null ? row.hourlyRate.toFixed(2) : ""),
        csvField(row.loadingAud != null ? row.loadingAud.toFixed(2) : ""),
      ].join(","),
    );
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const pad = (cells: (string | number)[]) => {
    const out = new Array(CSV_HEADER.length).fill("");
    cells.forEach((c, i) => (out[i] = csvField(c)));
    return out.join(",");
  };

  lines.push("");
  lines.push(pad([`TOTAL (${plural(r.totals.pricedRows, "priced row")})`, "", "", "", "", "", "", "", "", "", r.totals.loadingHours.toFixed(2), "", r.totals.pricedAud.toFixed(2)]));
  if (r.totals.unpricedRows > 0) {
    lines.push(pad([`UNPRICED (${plural(r.totals.unpricedRows, "row")}, no hourly rate)`, "", "", "", "", "", "", "", "", "", r.totals.unpricedHours.toFixed(2)]));
  }
  if (r.openShifts > 0) {
    lines.push(pad([`${plural(r.openShifts, "shift")} still open — not assessed`]));
  }
  return lines.join("\n");
}

/** break-loading_brightwater-hotel_2026-08-31_2026-09-06.csv */
export function csvFilename(r: WeeklyBreakReport, tz = TZ): string {
  const slug = (r.siteName ?? "all-venues").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `break-loading_${slug}_${localDate(r.weekStart, tz)}_${localDate(r.weekEnd - 1, tz)}.csv`;
}
