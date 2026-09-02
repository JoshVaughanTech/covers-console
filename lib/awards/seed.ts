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
  { userId: "w:priya-sharma", name: "Priya Sharma", role: "Functions Coordinator", siteName: "Werribee Park Wedding", employmentType: "part_time", ordinaryHourlyRate: 28.87,
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
