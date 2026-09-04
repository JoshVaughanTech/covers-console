/* ============================================================
   Who may run the console.

   A separate roster from the staff in lib/idara/seed.ts, and
   deliberately not derived from it. An operator is not a worker with
   a flag: the two are different populations with different powers,
   and the console's power is to mint other people's credentials.

   Kept here rather than in the Idara seed so the trust layer's staff
   list stays a staff list. CONSOLE_OPERATOR still exists there as
   the demo constant it always was; when nothing references it any
   more, deleting it is one line rather than a migration.

   The dids follow the :u: convention the seed already uses, and
   nothing anywhere authorises on that. Which roster minted a grant
   decides what the resulting session may do, and that decision is
   recorded on the row at issue time. A did is an identifier; a
   prefix is a naming convention, and the day somebody adds an
   operator whose did was minted under the other convention, string
   parsing gets it wrong and gets it wrong silently.
   ============================================================ */

export interface Operator {
  did: string;
  name: string;
  role: string;
}

export const OPERATORS: Operator[] = [
  { did: "did:web:idara.app:u:emma-taylor", name: "Emma Taylor", role: "Operations Manager" },
  { did: "did:web:idara.app:u:sophie-nguyen", name: "Sophie Nguyen", role: "Venue Manager" },
  { did: "did:web:idara.app:u:leanne-vidal", name: "Leanne Vidal", role: "Duty Manager" },
];

const INDEX = new Map(OPERATORS.map((o) => [o.did, o]));

/** The operator with this did, or undefined if they are not one. */
export function operator(did: string): Operator | undefined {
  return INDEX.get(did);
}

export function isOperator(did: string): boolean {
  return INDEX.has(did);
}
