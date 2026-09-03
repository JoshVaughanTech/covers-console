/* ============================================================
   Duties — the guard around the one shape that fails silently.

   decide() reads `input.duties ?? functionsForRole(person.role)`.
   That gives three cases, and they are not equally safe:

     duties undefined  falls back to the job title. An unmapped title
                       yields every function, so this over-gates. Loud.

     duties non-empty  the caller has said what the shift involves.
                       Exactly the point of per-shift duties.

     duties empty      asserts the shift involves no regulated work.
                       Every `appliesTo` requirement stops binding, and
                       nothing anywhere says so. Silent.

   The third is legitimate in one case only: a role that genuinely
   carries no regulated duty. A glassy clears tables and triggers no
   licence, so ROLE_FUNCTIONS.Glassy is []. An empty list for a
   Bartender is a mistake; the same list for a Glassy is the truth.

   So this module offers two things. A constructor that cannot build
   the dangerous shape, and a check that tells a form when an empty
   list is a mistake rather than a fact.
   ============================================================ */

import { functionsForRole } from "./hospitality";
import type { WorkFunction } from "./types";

/** One shift, and what it actually involves. Mirrors ShiftAssignment. */
export interface DutiedShift {
  id: string;
  duties?: WorkFunction[];
}

/**
 * Build a shift assignment that cannot under-gate.
 *
 * An empty list collapses to `undefined`, which falls back to the job title.
 * That is safe in every case rather than merely most: for a role with no
 * duties the fallback is also empty, so nothing changes; for any other role
 * the fallback over-gates, which is the direction that gets noticed.
 *
 * Prefer this over an object literal wherever the duty list is computed,
 * filtered, or user-supplied — those are where an empty array appears
 * without anyone intending it.
 */
export function shiftAssignment(id: string, duties?: WorkFunction[]): DutiedShift {
  return duties && duties.length > 0 ? { id, duties } : { id };
}

/**
 * Why this duty list is wrong for this role, or null if it is fine.
 *
 * For forms, where an empty list needs an explanation rather than a silent
 * correction — the manager should name the duties, not have them guessed.
 */
export function checkDuties(role: string, duties: WorkFunction[]): string | null {
  if (duties.length > 0) return null;
  if (functionsForRole(role).length === 0) return null; // a glassy, and correct
  return "Pick at least one duty — a shift with none is not gated";
}

/** True when a role carries no regulated duty of its own. */
export function roleCarriesNoDuties(role: string): boolean {
  return role.length > 0 && functionsForRole(role).length === 0;
}
