/* ============================================================
   Shifts — the demo's open postings
   Spread across in-house venue work and client-paid off-premise
   catering, so the client-preference component has somewhere to
   apply and somewhere to be correctly absent.
   ============================================================ */

import { WORKERS } from "@/lib/idara";
import type { ShiftPay, ShiftPosting } from "./types";

const W = Object.fromEntries(WORKERS.map((w) => [w.name, w.did])) as Record<string, string>;

/* ---------- pay ----------

   The console's demo week is May 2024 (see TODAY in lib/idara/seed.ts), and
   the award rate table on file runs from 1 July 2026. Pricing a 2024 date
   against it would be pricing this year's shift at a floor that did not exist
   yet, so priceShift() refuses — correctly.

   So the pay block anchors to the next real occurrence of the same weekday,
   while `day` and `window` keep showing the demo week. Nothing about the money
   changes as a result: the award floor depends on the DAY OF WEEK and the
   CLOCK TIME, never on the calendar date. A Friday 17:00–01:00 shift prices
   identically in May 2024 and in September 2026 — the date is used only to
   pick which annual table applies, which is exactly the fact the demo week
   gets wrong and this fixes.

   The alternative, a hand-written 2024 rate table, would mean inventing
   historic legal minimums to make a demo render. */

const TZ = "Australia/Melbourne";

/** Wall-clock parts of a moment at the venue, not on whatever machine is running. */
function venueParts(ts: number) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(ts * 1000).map((x) => [x.type, x.value]));
  const DAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +p.year, mo: +p.month, d: +p.day,
    h: +p.hour % 24, mi: +p.minute,
    weekday: DAY[p.weekday as string] ?? 0,
  };
}

/**
 * Epoch seconds for a wall-clock time at the venue.
 *
 * Not `new Date().setHours()`: that reads the clock of whatever machine is
 * running, so a developer in London would seed a shift starting at 17:00 London
 * — 02:00 Melbourne — and the board would price a bar shift at the weekday
 * night rate. Converge on the offset instead, twice, which is enough to land
 * correctly on either side of a daylight-saving boundary.
 */
function venueEpoch(y: number, mo: number, d: number, h: number, mi = 0): number {
  const target = Date.UTC(y, mo - 1, d, h, mi) / 1000;
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const p = venueParts(ts);
    ts += target - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) / 1000;
  }
  return ts;
}

/** Epoch seconds for the next `weekday` strictly after today, at h:m venue time. */
function nextWeekdayAt(weekday: number, h: number, m = 0, from = Math.floor(Date.now() / 1000)): number {
  const t = venueParts(from);
  const delta = (weekday - t.weekday + 7) % 7 || 7;
  return venueEpoch(t.y, t.mo, t.d + delta, h, m);
}

const FRI = 5, SAT = 6, SUN = 0;

/**
 * A pay block from a weekday and a local time window. Hours are decimal
 * (17.5 = 17:30) and an end before the start means the shift crosses midnight,
 * which is the case that makes the Saturday rate turn up in a Friday shift.
 */
function pay(
  weekday: number,
  startH: number,
  endH: number,
  offeredHourlyCents: number,
  rest: Pick<ShiftPay, "level" | "employment"> & Partial<Pick<ShiftPay, "unpaidBreakSec">>,
): ShiftPay {
  const startsAt = nextWeekdayAt(weekday, Math.floor(startH), Math.round((startH % 1) * 60));
  const hours = endH > startH ? endH - startH : 24 - startH + endH;
  return { ...rest, offeredHourlyCents, startsAt, endsAt: startsAt + Math.round(hours * 3600) };
}

const CASUAL = { employment: "casual" } as const;

export const POSTINGS: ShiftPosting[] = [
  {
    id: "sp-2038-wait",
    role: "Wait Staff",
    seats: 2,
    functionName: "Docklands Corporate Lunch",
    functionRef: "FN-2038",
    client: "Meridian Group",
    siteId: "s-docklands-lunch",
    day: "Fri, 17 May",
    window: "10:30–15:30",
    shiftId: "Fri",
    duties: ["serve_alcohol", "handle_food"],
    requires: [
      { skill: "silver_service", level: "solid" },
      { skill: "wine_service", level: "solid" },
    ],
    // 5h weekday lunch: ordinary hours throughout, no loadings
    pay: pay(FRI, 10.5, 15.5, 3600, { level: 2, ...CASUAL }),
    claims: [{ did: W["Priya Sharma"], at: "2024-05-16" }],
    assigned: [W["Leanne Vidal"]],
    status: "open",
  },
  {
    // in-house: no client, so client preference correctly never applies
    id: "sp-fridaylive-bar",
    role: "Bartender",
    seats: 3,
    functionName: "Brightwater Friday Live",
    siteId: "s-brightwater",
    day: "Fri, 17 May",
    window: "17:00–01:00",
    shiftId: "Fri",
    duties: ["serve_alcohol", "handle_food"],
    requires: [
      { skill: "cocktails", level: "solid" },
      { skill: "till_pos", level: "solid" },
    ],
    /* The shift the pricing model exists for. 17:00–01:00 crosses 19:00 into
       the evening loading and midnight into Saturday, so it prices in three
       bands — $33.85, $36.80, $40.62 — and a flat rate has to clear the
       dearest of them, not the $36.54 average. */
    pay: pay(FRI, 17, 1, 4150, { level: 2, ...CASUAL, unpaidBreakSec: 30 * 60 }),
    claims: [{ did: W["Aaron Patel"], at: "2024-05-16" }],
    assigned: [W["Darie Roberts"]],
    status: "open",
  },
  {
    id: "sp-2041-wait",
    role: "Wait Staff",
    seats: 3,
    functionName: "Werribee Park Wedding",
    functionRef: "FN-2041",
    client: "Nguyen & Cole (private)",
    siteId: "s-werribee-wedding",
    day: "Sat, 18 May",
    window: "15:00–23:30",
    shiftId: "Sat",
    duties: ["serve_alcohol", "handle_food"],
    requires: [
      { skill: "silver_service", level: "solid" },
      { skill: "plated_events", level: "solid" },
      { skill: "wine_service", level: "basic" },
    ],
    // silver service and plated events put this at food and beverage grade 3
    pay: pay(SAT, 15, 23.5, 4800, { level: 3, ...CASUAL, unpaidBreakSec: 30 * 60 }),
    claims: [
      { did: W["Mitch Egan"], at: "2024-05-16" },
      // claimed while his RSA was good; it was revoked afterwards. The request
      // was fine when made — the facts moved, which is the case the review
      // exists to surface rather than leave sitting in the queue.
      { did: W["Michael Tan"], at: "2024-05-10" },
    ],
    assigned: [W["Priya Sharma"]],
    status: "open",
  },
  {
    id: "sp-2041-bar",
    role: "Bartender",
    seats: 2,
    functionName: "Werribee Park Wedding",
    functionRef: "FN-2041",
    client: "Nguyen & Cole (private)",
    siteId: "s-werribee-wedding",
    day: "Sat, 18 May",
    window: "16:00–00:00",
    shiftId: "Sat",
    duties: ["serve_alcohol"],
    requires: [
      { skill: "cocktails", level: "lead" },
      { skill: "wine_service", level: "solid" },
    ],
    // runs to midnight but not past it, so Saturday throughout
    pay: pay(SAT, 16, 0, 4400, { level: 3, ...CASUAL, unpaidBreakSec: 30 * 60 }),
    claims: [],
    assigned: [],
    status: "open",
  },
  {
    id: "sp-quayside-wait",
    role: "Wait Staff",
    seats: 4,
    functionName: "Quayside Product Launch",
    client: "Aperture Studios",
    siteId: "s-quayside",
    day: "Sun, 19 May",
    window: "17:30–22:00",
    shiftId: "Sun",
    duties: ["serve_alcohol", "handle_food"],
    requires: [{ skill: "canapes", level: "solid" }],
    /* Deliberately UNDER the Sunday floor of $47.39, and deliberately still a
       draft: this is what a manager has half-typed. payBlockReason() refuses to
       publish it, and the demo needs that refusal to be reachable rather than
       only described. */
    pay: pay(SUN, 17.5, 22, 4400, { level: 2, ...CASUAL }),
    claims: [],
    assigned: [],
    status: "draft",
  },
];
