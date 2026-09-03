/* ============================================================
   Demo shift sessions for the Break Compliance board.
   Anchored to the moment the module loads so every Table 2 state
   is on screen at once and the clocks genuinely tick. Names,
   roles and sites match the rest of the console's mock world.
   ============================================================ */
import type { ShiftSession } from "./higa";

const H = 3600;
const M = 60;
const BOOT = Math.floor(Date.now() / 1000);

export function demoNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** "clocked in h hours and m minutes before boot" */
const at = (h: number, m = 0) => BOOT - Math.round(h * H + m * M);

export const DEMO_SESSIONS: ShiftSession[] = [
  // Overdue — 6h20 in on an 8h roster, no meal break. Loading accruing.
  { userId: "w:darie-roberts", name: "Darie Roberts", role: "Bartender", siteName: "Brightwater Hotel", employmentType: "casual", ordinaryHourlyRate: 31.23,
    clockIn: at(6, 20), plannedEnd: at(6, 20) + 8 * H, breaks: [] },
  // Due soon — 5h25 in, no meal, 8h roster.
  { userId: "w:liam-obrien", name: "Liam O'Brien", role: "Barback", siteName: "Brightwater Hotel", employmentType: "casual", ordinaryHourlyRate: 31.23,
    clockIn: at(5, 25), plannedEnd: at(5, 25) + 8 * H, breaks: [] },
  // cl 16.7(a) — meal at 2h30, now 7h45 in, 10h roster; also owed a paid rest.
  { userId: "w:hassan-ali", name: "Hassan Ali", role: "Head Chef", siteName: "Brightwater Hotel", employmentType: "full_time", ordinaryHourlyRate: 29.64,
    clockIn: at(7, 45), plannedEnd: at(7, 45) + 10 * H,
    breaks: [{ kind: "meal", start: at(7, 45) + 2.5 * H, end: at(7, 45) + 3 * H }] },
  // On meal break right now.
  { userId: "w:mitch-egan", name: "Mitch Egan", role: "Gaming Attendant", siteName: "Brightwater Gaming Room", employmentType: "casual", ordinaryHourlyRate: 31.23,
    clockIn: at(4, 10), plannedEnd: at(4, 10) + 7 * H,
    breaks: [{ kind: "meal", start: at(0, 12), end: null }] },
  // Window open — 3h in, 8h roster.
  { userId: "w:priya-sharma", name: "Priya Sharma", role: "Events Coordinator", siteName: "Werribee Park Wedding", employmentType: "part_time", ordinaryHourlyRate: 28.87,
    clockIn: at(3, 5), plannedEnd: at(3, 5) + 8 * H, breaks: [] },
  // Too early — 1h in.
  { userId: "w:jake-morrison", name: "Jake Morrison", role: "Bar Attendant", siteName: "Northside Tavern", employmentType: "casual", ordinaryHourlyRate: 31.23,
    clockIn: at(1, 0), plannedEnd: at(1, 0) + 8 * H, breaks: [] },
  // 11h roster — meal + one rest done, second rest owed.
  { userId: "w:leanne-vidal", name: "Leanne Vidal", role: "Duty Manager", siteName: "Brightwater Hotel", employmentType: "full_time", ordinaryHourlyRate: 28.87,
    clockIn: at(8, 30), plannedEnd: at(8, 30) + 11 * H,
    breaks: [
      { kind: "rest", start: at(8, 30) + 2 * H, end: at(8, 30) + 2 * H + 20 * M },
      { kind: "meal", start: at(8, 30) + 4.5 * H, end: at(8, 30) + 5 * H },
    ] },
  // Short 4h shift — no entitlement.
  { userId: "w:michael-tan", name: "Michael Tan", role: "Wait Staff", siteName: "Docklands Corporate Lunch", employmentType: "casual", ordinaryHourlyRate: 25.8,
    clockIn: at(2, 0), plannedEnd: at(2, 0) + 4 * H, breaks: [] },
  // No roster link, 5h15 elapsed — elective zone.
  { userId: "w:aaron-patel", name: "Aaron Patel", role: "Bartender", siteName: "Quayside Bar & Kitchen", employmentType: "casual", ordinaryHourlyRate: 31.23,
    clockIn: at(5, 15), plannedEnd: null, breaks: [] },
];

/* ============================================================
   A completed week, for the payroll loading report.

   Anchored to the last complete Mon–Sun relative to boot, so the
   report's default week always has data. Deliberately mostly clean:
   a week where every row is a breach proves nothing. The two guard
   shifts at the end must produce no money — they are the report's
   false-positive tests made visible in the demo.
   ============================================================ */
import { lastCompleteWeek } from "./report";

const WEEK = lastCompleteWeek(BOOT);

/** day d (0 = Monday) of the demo week, at local hour h:m */
const day = (d: number, h: number, m = 0) => WEEK.start + d * 86400 + h * H + m * M;

/** a clean shift: meal taken at the 3h mark */
const clean = (
  userId: string, name: string, role: string, siteName: string, rate: number,
  d: number, startH: number, lenH: number,
): ShiftSession => ({
  userId, name, role, siteName, employmentType: "casual", ordinaryHourlyRate: rate,
  clockIn: day(d, startH), clockOut: day(d, startH) + lenH * H,
  plannedEnd: day(d, startH) + lenH * H,
  breaks: [{ kind: "meal", start: day(d, startH) + 3 * H, end: day(d, startH) + 3.5 * H }],
});

export const DEMO_WEEK_SESSIONS: ShiftSession[] = [
  // ---- clean shifts: meal in window, no loading ----
  clean("w:priya-sharma", "Priya Sharma", "Events Coordinator", "Brightwater Hotel", 28.87, 0, 10, 8),
  clean("w:priya-sharma", "Priya Sharma", "Events Coordinator", "Brightwater Hotel", 28.87, 1, 10, 8),
  clean("w:michael-tan", "Michael Tan", "Wait Staff", "Brightwater Hotel", 25.8, 2, 11, 8),
  clean("w:jake-morrison", "Jake Morrison", "Bar Attendant", "Northside Tavern", 31.23, 3, 16, 8),
  clean("w:mitch-egan", "Mitch Egan", "Gaming Attendant", "Brightwater Gaming Room", 31.23, 4, 9, 9),

  // ---- MEAL_MISSED: 8h close shift, no meal at all. Loading 6h → clock-out. ----
  { userId: "w:darie-roberts", name: "Darie Roberts", role: "Bartender", siteName: "Brightwater Hotel",
    employmentType: "casual", ordinaryHourlyRate: 31.23,
    clockIn: day(1, 16), clockOut: day(1, 16) + 8 * H, plannedEnd: day(1, 16) + 8 * H, breaks: [] },
  // second breach for the same person — proves per-person aggregation
  { userId: "w:darie-roberts", name: "Darie Roberts", role: "Bartender", siteName: "Brightwater Hotel",
    employmentType: "casual", ordinaryHourlyRate: 31.23,
    clockIn: day(4, 16), clockOut: day(4, 16) + 7 * H, plannedEnd: day(4, 16) + 7 * H, breaks: [] },

  // ---- MEAL_LATE_HISTORIC: 11h shift, meal at 6h40. Loading 6h → 6h40. ----
  { userId: "w:leanne-vidal", name: "Leanne Vidal", role: "Duty Manager", siteName: "Brightwater Hotel",
    employmentType: "full_time", ordinaryHourlyRate: 28.87,
    clockIn: day(2, 6), clockOut: day(2, 6) + 11 * H, plannedEnd: day(2, 6) + 11 * H,
    breaks: [{ kind: "meal", start: day(2, 6) + 6 * H + 40 * M, end: day(2, 6) + 7 * H + 10 * M }] },

  // ---- unpriced: a real breach with no hourly rate. Hours count, dollars must not. ----
  { userId: "w:hassan-ali", name: "Hassan Ali", role: "Head Chef", siteName: "Brightwater Hotel",
    employmentType: "full_time", ordinaryHourlyRate: null,
    clockIn: day(3, 6), clockOut: day(3, 6) + 9 * H, plannedEnd: day(3, 6) + 9 * H, breaks: [] },

  // ---- still open at week end: excluded from rows, counted separately ----
  { userId: "w:aaron-patel", name: "Aaron Patel", role: "Bartender", siteName: "Quayside Bar & Kitchen",
    employmentType: "casual", ordinaryHourlyRate: 31.23,
    clockIn: day(6, 18), clockOut: null, plannedEnd: null, breaks: [] },

  // ---- guard: 5h30, no meal. Elective zone (16.4) — must NOT be a breach. ----
  { userId: "w:liam-obrien", name: "Liam O'Brien", role: "Barback", siteName: "Brightwater Hotel",
    employmentType: "casual", ordinaryHourlyRate: 31.23,
    clockIn: day(5, 12), clockOut: day(5, 12) + 5.5 * H, plannedEnd: day(5, 12) + 5.5 * H, breaks: [] },

  // ---- guard: 10h30, meal on time, rests short. 16.7 carries no money. ----
  { userId: "w:sophie-nguyen", name: "Sophie Nguyen", role: "Venue Manager", siteName: "Brightwater Hotel",
    employmentType: "full_time", ordinaryHourlyRate: 34.1,
    clockIn: day(5, 8), clockOut: day(5, 8) + 10.5 * H, plannedEnd: day(5, 8) + 10.5 * H,
    breaks: [{ kind: "meal", start: day(5, 8) + 3 * H, end: day(5, 8) + 3.5 * H }] },
];

/** the week DEMO_WEEK_SESSIONS covers — [start, end) epoch seconds */
export const DEMO_WEEK = WEEK;
