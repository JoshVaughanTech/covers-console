/* ============================================================
   Posting a shift.

   Turning a form into a ShiftPosting, with the validation that
   matters kept here rather than in the component — a posting is
   the thing Idara gates against, so a malformed one is a
   compliance problem, not a cosmetic one.

   The rule worth stating: duties must not be empty. decideMember()
   reads `input.duties ?? functionsForRole(person.role)`, so an
   empty array is not a fallback to the job title — it is a claim
   that the shift involves no regulated work at all, and every
   duty-scoped requirement (RSG at a gaming room, for one) silently
   stops applying. Absent duties over-gate, which is loud. Empty
   duties under-gate, which is silent. So we refuse to create one.
   ============================================================ */

import { functionsForRole, type WorkFunction } from "@/lib/idara";
import type { ShiftPosting, SkillRequirement } from "./types";

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

  // see the header: an empty duty list turns the gate off silently
  if (d.duties.length === 0) {
    errors.push("Pick at least one duty — a shift with none is not gated");
  }
  return errors;
}

export function buildPosting(d: PostingDraft, id: string, shiftId: string): DraftResult {
  const errors = validateDraft(d);
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    posting: {
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
