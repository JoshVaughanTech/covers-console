/* ============================================================
   Awards — Hospitality Industry (General) Award 2020 [MA000009]
   What a shift must pay. Clause 18 (minimum rates) and clause 29
   (penalty rates), against the FWO Pay Guide effective 01/07/2026.

   higa.ts answers what is owed in TIME. This answers what is owed
   in MONEY, and it is the module every dollar in the marketplace
   was waiting on: until now `ordinaryHourlyRate` was a hand-typed
   number on a seed row that reached the penalty estimate, the
   payroll report and the "$ vs award" badge as though it were a
   fact somebody had checked.

   The rule this exists to make visible:

     THE FLOOR IS PER HOUR WORKED, NOT PER SHIFT.

   A Friday 17:00–01:00 bar shift crosses three bands — ordinary,
   evening, then Saturday after midnight. For a casual Level 2 that
   is $33.85, $36.80 and $40.62 an hour. A flat $37.00 offer beats
   the $36.54 blended average and still underpays the midnight hour.
   So priceShift() returns segments, and assessOffer() refuses an
   offer below ANY of them. Only the display uses the blend.

   Only the seven adult base rates are stored; every other cell in
   the published guide is derived from them by the percentages in
   MULTIPLIERS. tests/rates.test.ts regenerates the printed cells
   and asserts them to the cent — the same bargain the push
   encryption makes with RFC 8291. If a derived cell disagrees with
   the guide, this model is wrong and the test is what says so.

   Not modelled: see NOT_MODELLED. This is the floor for ordinary
   hours. It is not payroll and must not be presented as payroll.
   ============================================================ */

import type { EmploymentType } from "./higa";

/* ---------- the table ---------- */

/**
 * Adult classification levels, clause 18 Table 3.
 *
 * Which level a job sits at is a legal position about duties, and it is the
 * venue's call — never inferred here from a role string. "Bartender" is not a
 * level, and code that guessed would be inventing the answer to the question
 * that decides someone's pay. See suggestedLevel() for the one place a guess
 * is allowed, and what it is fenced with.
 */
export type Level = "introductory" | 1 | 2 | 3 | 4 | 5 | 6;

export const LEVELS: readonly Level[] = ["introductory", 1, 2, 3, 4, 5, 6];

/** Which column of the penalty table applies to the hours worked. */
export type Band = "ordinary" | "saturday" | "sunday" | "public_holiday";

/** A flat per-hour adder that applies on weekdays only. */
export type Adder = "evening" | "night";

export interface RateTable {
  awardId: string;
  /** ISO date the rates apply from — first full pay period on or after. */
  effectiveFrom: string;
  /** ISO date they stop being current, once a successor is published. */
  supersededFrom: string | null;
  source: string;
  /** minimum hourly rate, integer cents, clause 18 Table 3. */
  baseHourlyCents: Record<string, number>;
  /** integer PERCENT of the base hourly rate. Casual columns include the 25% loading. */
  multipliers: Record<Band, { permanent: number; casual: number }>;
  /** flat cents per hour or part of an hour, Mon–Fri only. */
  adderCentsPerHour: Record<Adder, number>;
}

/**
 * FWO Pay Guide, MA000009, effective 01/07/2026, published 24/06/2026.
 * Base rates are clause 18 Table 3 weekly ÷ 38, as printed.
 *
 * `supersededFrom` is null because no successor has been published, NOT
 * because these rates are known to run forever. The annual review lands
 * each 1 July, so a table left here past then prices shifts at last year's
 * floor while claiming to be the floor. covers() below is what stops that
 * being silent.
 */
export const HIGA_RATES_2026: RateTable = {
  awardId: "MA000009",
  effectiveFrom: "2026-07-01",
  supersededFrom: null,
  source: "https://calculate.fairwork.gov.au/ArticleDocuments/872/hospitality-industry-general-award-ma000009-pay-guide.pdf.aspx",
  baseHourlyCents: {
    introductory: 2574, // $978.10 / 38
    1: 2644, // $1,004.90 / 38
    2: 2708, // $1,029.10 / 38
    3: 2797, // $1,062.90 / 38
    4: 2945, // $1,119.10 / 38
    5: 3130, // $1,189.40 / 38
    6: 3213, // $1,221.10 / 38
  },
  multipliers: {
    ordinary: { permanent: 100, casual: 125 },
    saturday: { permanent: 125, casual: 150 },
    sunday: { permanent: 150, casual: 175 },
    public_holiday: { permanent: 225, casual: 250 },
  },
  adderCentsPerHour: {
    evening: 295, // Mon–Fri 19:00–24:00
    night: 442, // Mon–Fri 00:00–07:00
  },
};

/**
 * What this module does not answer. Returned with every price so a caller can
 * print the list rather than let a figure imply a completeness it doesn't have.
 */
export const NOT_MODELLED: readonly string[] = [
  "overtime",
  "junior and apprentice rates",
  "casino classifications",
  "the managerial salary path (cl 18.3)",
  "allowances (split shift, cold work, laundry, meal, fork-lift)",
  "annual leave loading",
  "overnight stay",
  "higher duties",
  "enterprise agreements, which displace the award entirely",
];

/* ---------- band boundaries ---------- */

const EVENING_FROM_H = 19;
const NIGHT_UNTIL_H = 7;
const MINUTE = 60;

/** Cents, rounded half-up. Integer inputs keep the product exact. */
function pct(baseCents: number, percent: number): number {
  return Math.round((baseCents * percent) / 100);
}

/** Money for display: 3385 → "$33.85". */
export function fmtAud(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}$${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/**
 * Local wall-clock parts of a moment, in the venue's timezone.
 *
 * Everything here turns on local time — 19:00 Melbourne, Saturday in Melbourne
 * — so a UTC reading of the same instant would put the evening loading in the
 * wrong place and, twice a year, the Saturday rate on the wrong day.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/* Built once per timezone, not once per minute. priceShift() walks the shift a
   minute at a time and the API route prices every posting on the board, so a
   formatter constructed inside that loop is thousands of them per request. */
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

function localParts(ts: number, tz: string): { date: string; weekday: number; hour: number; minute: number } {
  const p = Object.fromEntries(formatterFor(tz).formatToParts(ts * 1000).map((x) => [x.type, x.value]));
  const DAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: DAY[p.weekday as string] ?? 0,
    // Intl renders midnight as "24" in some ICU versions; normalise it
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}

/** Which penalty column applies at this local moment. */
function bandAt(parts: { date: string; weekday: number }, holidays: ReadonlySet<string>): Band {
  if (holidays.has(parts.date)) return "public_holiday";
  if (parts.weekday === 0) return "sunday";
  if (parts.weekday === 6) return "saturday";
  return "ordinary";
}

/**
 * Which flat adder applies, if any. Weekdays only: the guide's evening and
 * night columns are both headed "Monday to Friday", so the hour after
 * midnight on a Saturday is Saturday-rated and attracts no night adder.
 */
function adderAt(parts: { weekday: number; hour: number }, band: Band): Adder | null {
  if (band !== "ordinary") return null;
  if (parts.hour >= EVENING_FROM_H) return "evening";
  if (parts.hour < NIGHT_UNTIL_H) return "night";
  return null;
}

/* ---------- pricing ---------- */

export interface RateSegment {
  band: Band;
  adder: Adder | null;
  /** epoch seconds */
  from: number;
  to: number;
  seconds: number;
  /** the band rate for these hours, before the flat adder. */
  hourlyCents: number;
  /** hourly floor a flat offer must clear for THIS segment, adder included. */
  effectiveHourlyCents: number;
  /** whole hours the adder is charged for — ceil, see "part of an hour". */
  adderHours: number;
  adderCents: number;
  /** band pay + adder for this segment. */
  subtotalCents: number;
}

export interface ShiftPrice {
  awardId: string;
  effectiveFrom: string;
  source: string;
  level: Level;
  employment: EmploymentType;
  /** paid seconds — the unpaid meal break is already removed. */
  paidSeconds: number;
  unpaidSeconds: number;
  /**
   * One run per band the shift SPANS, unpaid break included.
   *
   * Deliberately the whole span and not the paid hours. Where the meal break
   * actually falls is not recorded, so the only safe assumption is that the
   * person works in every band the shift touches — and the rate test is built
   * on these. Trimming them first would let a shift ending at 00:20 with a
   * 30-minute break lose its Saturday run entirely, and with it the only
   * reason a $37.00 offer should have been refused.
   */
  segments: RateSegment[];
  /** the whole shift's minimum, in cents. */
  floorCents: number;
  /** floorCents spread over the paid hours — for display, never for the gate. */
  blendedHourlyCents: number;
  /** the dearest segment: what a single flat rate has to clear. */
  minimumFlatHourlyCents: number;
  /** false when no public holiday calendar was supplied, so none was ruled out. */
  publicHolidaysChecked: boolean;
  notModelled: readonly string[];
}

export interface PriceInput {
  level: Level;
  employment: EmploymentType;
  /** epoch seconds */
  start: number;
  end: number;
  /** unpaid meal break, deducted from the LAST hours priced. */
  unpaidBreakSec?: number;
  timezone?: string;
  /** ISO dates that are public holidays where the shift is worked. */
  publicHolidays?: readonly string[];
  table?: RateTable;
}

/** Thrown rather than returned: a wrong wage figure must not be mistakable for a right one. */
export class RateTableRangeError extends Error {
  constructor(readonly isoDate: string, readonly table: RateTable) {
    super(
      `No ${table.awardId} rates on file for ${isoDate}. The table on hand runs from ${table.effectiveFrom}` +
        `${table.supersededFrom ? ` to ${table.supersededFrom}` : ""}. Rates are reviewed each 1 July; pricing outside that window would report last year's floor as this year's.`,
    );
  }
}

/** True when this table is the right one to price a given local date with. */
export function covers(table: RateTable, isoDate: string): boolean {
  if (isoDate < table.effectiveFrom) return false;
  if (table.supersededFrom && isoDate >= table.supersededFrom) return false;
  return true;
}

/** The hourly floor for one band. The simple question the UI usually asks. */
export function floorHourly(
  level: Level,
  employment: EmploymentType,
  band: Band = "ordinary",
  table: RateTable = HIGA_RATES_2026,
): number {
  const base = table.baseHourlyCents[String(level)];
  if (base == null) throw new Error(`Unknown ${table.awardId} classification: ${String(level)}`);
  const m = table.multipliers[band];
  return pct(base, employment === "casual" ? m.casual : m.permanent);
}

/**
 * Price a shift against the award, hour by hour.
 *
 * Walks the shift a minute at a time and groups runs that share a band and an
 * adder. A minute is deliberate rather than clever: shift boundaries, 19:00,
 * midnight and 07:00 all land on minutes, and 480 steps for an 8-hour shift is
 * nothing next to being able to read the loop and see that it is right.
 */
export function priceShift(input: PriceInput): ShiftPrice {
  const table = input.table ?? HIGA_RATES_2026;
  const tz = input.timezone ?? "Australia/Melbourne";
  const holidays = new Set(input.publicHolidays ?? []);
  const { level, employment } = input;

  if (input.end <= input.start) throw new Error("A shift must end after it starts.");

  const startDay = localParts(input.start, tz).date;
  if (!covers(table, startDay)) throw new RateTableRangeError(startDay, table);

  const base = table.baseHourlyCents[String(level)];
  if (base == null) throw new Error(`Unknown ${table.awardId} classification: ${String(level)}`);

  const unpaidSeconds = Math.max(0, Math.min(input.unpaidBreakSec ?? 0, input.end - input.start));
  const paidSeconds = input.end - input.start - unpaidSeconds;

  /* Walked over the WHOLE span, break included — see ShiftPrice.segments. */
  const runs: { band: Band; adder: Adder | null; from: number; to: number }[] = [];
  for (let t = input.start; t < input.end; t += MINUTE) {
    const parts = localParts(t, tz);
    const band = bandAt(parts, holidays);
    const adder = adderAt(parts, band);
    const to = Math.min(t + MINUTE, input.end);
    const last = runs[runs.length - 1];
    if (last && last.band === band && last.adder === adder && last.to === t) last.to = to;
    else runs.push({ band, adder, from: t, to });
  }

  const segments: RateSegment[] = runs.map((r) => {
    const seconds = r.to - r.from;
    const hourlyCents = pct(base, employment === "casual" ? table.multipliers[r.band].casual : table.multipliers[r.band].permanent);
    /* "per hour or part of an hour" — a part-hour in the band attracts the
       whole adder, so 70 minutes of evening is charged twice, not 1.17 times.
       Prorating would be the natural reading of a rate and the wrong reading
       of this phrase, and it underpays. */
    const adderHours = r.adder ? Math.ceil(seconds / 3600) : 0;
    const adderCents = r.adder ? adderHours * table.adderCentsPerHour[r.adder] : 0;
    return {
      band: r.band,
      adder: r.adder,
      from: r.from,
      to: r.to,
      seconds,
      hourlyCents,
      effectiveHourlyCents: hourlyCents + (r.adder ? table.adderCentsPerHour[r.adder] : 0),
      adderHours,
      adderCents,
      subtotalCents: Math.round((hourlyCents * seconds) / 3600) + adderCents,
    };
  });

  /* The money, which DOES need the break taken out.

     Where the break falls is unrecorded, so the unpaid minutes come off the
     end. That is a choice, and it is the conservative one for a total: the
     last hours of a night shift are the dearest, so removing them understates
     the floor rather than overstating it, and nobody is told they are owed
     more than they are. It only ever affects this figure — the rate test above
     runs on the untrimmed span, so an understated total cannot become a hole
     in the gate. */
  let remaining = paidSeconds;
  const floorCents = segments.reduce((total, s) => {
    if (remaining <= 0) return total;
    const paidHere = Math.min(s.seconds, remaining);
    remaining -= paidHere;
    const adderPerHour = s.effectiveHourlyCents - s.hourlyCents;
    const adderHours = s.adder ? Math.ceil(paidHere / 3600) : 0;
    return total + Math.round((s.hourlyCents * paidHere) / 3600) + adderHours * adderPerHour;
  }, 0);

  return {
    awardId: table.awardId,
    effectiveFrom: table.effectiveFrom,
    source: table.source,
    level,
    employment,
    paidSeconds,
    unpaidSeconds,
    segments,
    floorCents,
    blendedHourlyCents: paidSeconds > 0 ? Math.round((floorCents * 3600) / paidSeconds) : 0,
    minimumFlatHourlyCents: segments.reduce((a, s) => Math.max(a, s.effectiveHourlyCents), 0),
    publicHolidaysChecked: input.publicHolidays != null,
    notModelled: NOT_MODELLED,
  };
}

/* ---------- comparing an offer to the floor ---------- */

export interface OfferAssessment {
  price: ShiftPrice;
  offeredHourlyCents: number;
  /** the whole test: no segment may be short. */
  atOrAboveFloor: boolean;
  /** segments the offer does not cover, dearest first. */
  shortSegments: RateSegment[];
  /** what the offer must reach to clear every hour. */
  requiredHourlyCents: number;
  /** offered − required. Negative when short. */
  marginHourlyCents: number;
  /** what the venue pays at the offered rate, for the paid hours. */
  offeredGrossCents: number;
  /** offeredGross − floor. Negative when the shift underpays overall too. */
  aboveFloorCents: number;
  /** one sentence, safe to render as-is. */
  summary: string;
}

/**
 * Does a flat hourly offer clear the award for every hour of this shift?
 *
 * The comparison is per segment, not against the blended average, and that is
 * the point of the function. A flat $37.00 on a Friday 17:00–01:00 casual
 * Level 2 shift beats the $36.54 average and underpays the midnight hour by
 * $3.62 — an average is exactly the shape of number that hides an underpayment
 * inside a shift that looks generous.
 */
export function assessOffer(offeredHourlyCents: number, input: PriceInput): OfferAssessment {
  const price = priceShift(input);
  const shortSegments = price.segments
    .filter((s) => s.effectiveHourlyCents > offeredHourlyCents)
    .sort((a, b) => b.effectiveHourlyCents - a.effectiveHourlyCents);

  const requiredHourlyCents = price.minimumFlatHourlyCents;
  const offeredGrossCents = Math.round((offeredHourlyCents * price.paidSeconds) / 3600);
  const atOrAboveFloor = shortSegments.length === 0;

  const worst = shortSegments[0];
  const summary = atOrAboveFloor
    ? `${fmtAud(offeredHourlyCents)}/h clears the award floor for every hour of this shift` +
      (offeredHourlyCents > requiredHourlyCents
        ? ` — ${fmtAud(offeredHourlyCents - requiredHourlyCents)}/h above the dearest hour.`
        : " — exactly at the floor.")
    : `${fmtAud(offeredHourlyCents)}/h is below the award for ${shortSegments.length} of ` +
      `${price.segments.length} rate periods in this shift. ${BAND_LABEL[worst.band]}` +
      `${worst.adder ? ` (${worst.adder})` : ""} hours are ${fmtAud(worst.effectiveHourlyCents)}/h — ` +
      `short by ${fmtAud(worst.effectiveHourlyCents - offeredHourlyCents)}/h.`;

  return {
    price,
    offeredHourlyCents,
    atOrAboveFloor,
    shortSegments,
    requiredHourlyCents,
    marginHourlyCents: offeredHourlyCents - requiredHourlyCents,
    offeredGrossCents,
    aboveFloorCents: offeredGrossCents - price.floorCents,
    summary,
  };
}

export const BAND_LABEL: Record<Band, string> = {
  ordinary: "Weekday",
  saturday: "Saturday",
  sunday: "Sunday",
  public_holiday: "Public holiday",
};

/** How a segment reads on a payslip line or a shift detail screen. */
export function describeSegment(s: RateSegment, tz = "Australia/Melbourne"): string {
  const clock = (ts: number) =>
    new Date(ts * 1000).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
  const label = s.adder === "evening" ? "Weekday evening" : s.adder === "night" ? "Weekday night" : BAND_LABEL[s.band];
  const adder = s.adder ? ` (${fmtAud(s.hourlyCents)} + ${fmtAud(s.adderCents / Math.max(1, s.adderHours))}/h)` : "";
  return `${clock(s.from)}–${clock(s.to)} · ${label} · ${fmtAud(s.effectiveHourlyCents)}/h${adder}`;
}

/* ---------- classification ---------- */

/**
 * A STARTING POINT for classifying a role. Never an answer.
 *
 * Which level a job sits at depends on what the person actually does — a
 * bartender who supervises and does the ordering is not the same level as one
 * who pours — and getting it wrong underpays somebody. So it is a decision a
 * venue records, not one a string match makes silently on their behalf.
 *
 * The fence is not reachability; this is re-exported through lib/awards like
 * everything else in the file. It is that nothing may turn the guess into a
 * stored classification on its own:
 *
 *   - priceShift() never calls this. It prices the level it was handed.
 *   - it may PRE-FILL a level a person then confirms, and may not write one.
 *
 * Returns null rather than guessing at an unrecognised role, because a wrong
 * default here would be indistinguishable from a confirmed one downstream.
 */
export function suggestedLevel(role: string): Level | null {
  const r = role.trim().toLowerCase();
  const table: [RegExp, Level][] = [
    [/^(head chef|executive chef)$/, 5],
    [/chef|cook \(tradesperson\)/, 4],
    [/duty manager|supervisor|venue manager/, 5],
    [/bartender|food and beverage attendant grade 2|wait staff|gaming attendant/, 2],
    [/barback|kitchen hand|kitchen attendant|runner|glassie/, 1],
    [/events coordinator|front office/, 3],
  ];
  for (const [re, level] of table) if (re.test(r)) return level;
  return null;
}
