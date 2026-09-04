/* ============================================================
   Posting a shift.

   Turning a form into a ShiftPosting, with the validation that
   matters kept here rather than in the component — a posting is
   the thing Idara gates against, so a malformed one is a
   compliance problem, not a cosmetic one.

   The rule worth stating: an empty duty list is usually a mistake,
   and a silent one. decideMember() reads
   `input.duties ?? functionsForRole(person.role)`, so an empty array
   is not a fallback to the job title — it claims the shift involves
   no regulated work, and every duty-scoped requirement (RSG at a
   gaming room, for one) stops applying with nothing to show for it.
   Absent duties over-gate, which is loud. Empty duties under-gate,
   which is not.

   "Usually", because one role genuinely carries no duty: a glassy
   clears tables and triggers no licence. So the test is not "are the
   duties empty" but "are they empty for a role that implies some" —
   which lives in lib/idara/duties.ts, shared with the schedule.
   ============================================================ */

import { functionsForRole, checkDuties, type WorkFunction } from "@/lib/idara";
import type { EmploymentType } from "@/lib/awards";
import { payBlockReason } from "./pay";
import type { ShiftPay, ShiftPosting, SkillRequirement } from "./types";

export interface PostingDraft {
  role: string;
  /** kept as the raw form string so a bad value can be reported, not coerced. */
  seats: string;
  functionName: string;
  functionRef: string;
  client: string;
  siteId: string;
  day: string;
  window: string;
  duties: WorkFunction[];
  requires: SkillRequirement[];
  /** publish straight to the board, or keep it as a draft. */
  publish: boolean;

  /* ---------- the rate ----------

     Blank throughout means no rate published yet, which is a real state and
     renders as exactly that. Half-filled is a mistake and is reported.

     `date`/`startTime`/`endTime` are separate from `day`/`window` because they
     are different KINDS of thing: those two are display text a manager types,
     these are the moments the award is applied to. Pricing a shift off
     "Fri, 17 May" would be pricing it off a typo. The form fills the display
     strings from these so they cannot drift apart in practice. */

  /** ISO date, "2026-09-11". */
  date: string;
  /** venue-local 24h clock, "17:00". An end before the start crosses midnight. */
  startTime: string;
  endTime: string;
  /** HIGA classification: "" | "introductory" | "1".."6". Authored, never derived. */
  level: string;
  employment: EmploymentType;
  /** dollars per hour as typed, e.g. "41.50". */
  rate: string;
  /** unpaid meal break in minutes, as typed. */
  unpaidBreakMin: string;
}

export type PayDraftResult =
  | { ok: true; pay?: ShiftPay }
  | { ok: false; errors: string[] };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Venue-local wall clock → epoch seconds. Converges on the offset; see seed.ts. */
function venueEpoch(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const target = Date.UTC(y, mo - 1, d, h, mi) / 1000;
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const p = Object.fromEntries(f.formatToParts(ts * 1000).map((x) => [x.type, x.value]));
    ts += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) / 1000;
  }
  return ts;
}

/**
 * The rate section of the form, turned into a ShiftPay — or the reasons it cannot be.
 *
 * Returns `{ ok: true }` with no pay when the section is untouched. A partly
 * filled section is an error rather than a silent no-rate: somebody who typed a
 * rate and no date meant to publish a rate, and dropping it quietly would put
 * the shift on the board paying nothing anyone agreed to.
 */
export function payFromDraft(d: PostingDraft, timezone = "Australia/Melbourne"): PayDraftResult {
  const parts = [d.date, d.startTime, d.endTime, d.level, d.rate];
  if (parts.every((p) => !p.trim())) return { ok: true };

  const errors: string[] = [];
  if (!DATE.test(d.date)) errors.push("Give the shift a date");
  if (!TIME.test(d.startTime)) errors.push("Give a start time, as HH:MM");
  if (!TIME.test(d.endTime)) errors.push("Give an end time, as HH:MM");
  if (!d.level.trim()) errors.push("Pick the award classification this role sits at");

  const dollars = Number(d.rate);
  if (!d.rate.trim() || !Number.isFinite(dollars) || dollars <= 0) errors.push("Give an hourly rate");

  const breakMin = d.unpaidBreakMin.trim() === "" ? 0 : Number(d.unpaidBreakMin);
  if (!Number.isFinite(breakMin) || breakMin < 0) errors.push("Unpaid break must be a number of minutes");

  if (errors.length) return { ok: false, errors };

  const startsAt = venueEpoch(d.date, d.startTime, timezone);
  let endsAt = venueEpoch(d.date, d.endTime, timezone);
  // an end at or before the start is the next day — an 8pm-to-4am shift, not a
  // negative one. Priced across midnight, which is where Saturday rates begin.
  if (endsAt <= startsAt) endsAt += 24 * 3600;

  return {
    ok: true,
    pay: {
      level: (/^\d+$/.test(d.level) ? Number(d.level) : d.level) as ShiftPay["level"],
      employment: d.employment,
      offeredHourlyCents: Math.round(dollars * 100),
      startsAt,
      endsAt,
      ...(breakMin > 0 ? { unpaidBreakSec: Math.round(breakMin * 60) } : {}),
    },
  };
}

export type DraftResult =
  | { ok: true; posting: ShiftPosting }
  | { ok: false; errors: string[] };

/** A blank draft, with duties pre-filled from the role once one is picked. */
export function emptyDraft(): PostingDraft {
  return {
    role: "",
    seats: "1",
    functionName: "",
    functionRef: "",
    client: "",
    siteId: "",
    day: "",
    window: "",
    duties: [],
    requires: [],
    publish: true,
    date: "",
    startTime: "",
    endTime: "",
    level: "",
    // the common case in this industry, and the one with the dearest floor —
    // so a manager who never touches the field is defaulted to over-paying
    // rather than under-paying
    employment: "casual",
    rate: "",
    unpaidBreakMin: "",
  };
}

/** What a role implies, as the starting point for the duty chips. */
export function dutiesForRole(role: string): WorkFunction[] {
  return role ? functionsForRole(role) : [];
}

export function validateDraft(d: PostingDraft): string[] {
  const errors: string[] = [];
  if (!d.role.trim()) errors.push("Pick a role");
  if (!d.functionName.trim()) errors.push("Name the event or function");
  if (!d.siteId) errors.push("Pick a site");
  if (!d.day.trim()) errors.push("Give a day");
  if (!d.window.trim()) errors.push("Give a time window");

  const seats = Number(d.seats);
  if (!Number.isInteger(seats) || seats < 1) errors.push("Seats must be a whole number, 1 or more");

  // see the header: an empty duty list turns the gate off silently — except
  // for a role that carries none, where empty is the truth rather than a slip
  const duties = checkDuties(d.role, d.duties);
  if (duties) errors.push(duties);

  /* The rate section's own errors belong in the same list. A form that reports
     "give a day" now and "give a start time" only after that is fixed makes the
     manager discover the work one round trip at a time. */
  const pay = payFromDraft(d);
  if (!pay.ok) errors.push(...pay.errors);

  return errors;
}

/**
 * Turn a draft into a posting, refusing one that would underpay.
 *
 * The rate normally comes from the draft's own pay section. `payOverride` is
 * for callers that already hold a ShiftPay — an import, an API, a test — and
 * skips only the parsing, never the gate: both routes end at the same
 * payBlockReason() below.
 *
 * The floor is checked here rather than in the form, because a compliance
 * promise enforced only where somebody happens to be typing is a promise about
 * the UI. This is the narrowest place every posting passes through, so it is
 * where "Covers will not publish below the award" is true.
 */
export function buildPosting(d: PostingDraft, id: string, shiftId: string, payOverride?: ShiftPay): DraftResult {
  const errors = validateDraft(d);

  const parsed = payFromDraft(d);
  const pay = payOverride ?? (parsed.ok ? parsed.pay : undefined);

  if (pay) {
    /* Checked on a draft too, not only on publish. A manager who saves an
       underpaying draft and publishes it a week later should have been told a
       week earlier, and the rate is the part they have to go and negotiate. */
    const underpaying = payBlockReason({ pay } as ShiftPosting);
    if (underpaying) errors.push(underpaying);
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    posting: {
      ...(pay ? { pay } : {}),
      id,
      role: d.role.trim(),
      seats: Number(d.seats),
      functionName: d.functionName.trim(),
      ...(d.functionRef.trim() ? { functionRef: d.functionRef.trim() } : {}),
      ...(d.client.trim() ? { client: d.client.trim() } : {}),
      siteId: d.siteId,
      day: d.day.trim(),
      window: d.window.trim(),
      shiftId,
      duties: d.duties,
      requires: d.requires,
      claims: [],
      assigned: [],
      status: d.publish ? "open" : "draft",
    },
  };
}
