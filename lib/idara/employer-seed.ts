/* ============================================================
   Idara — the demo employer.

   One profile, for the group that runs every site in the seed.
   Brightwater Hospitality is the employer at the pub, the gaming
   room, the tavern, the bar and both catering operations, which is
   how a hospitality group is actually shaped: one ABN, one payroll,
   one workers' compensation policy, many places to stand.

   The classifications are the part worth reading. Every role the
   demo postings ask for has a level recorded against it, because
   proposeEngagement() refuses a role it cannot classify — and that
   refusal is deliberate. Which level a job sits at decides what
   somebody is paid, so it is a position the venue records, never
   one this code infers from a job title. suggestedLevel() in
   lib/awards/rates.ts exists to PRE-FILL this table and is fenced
   off from writing to it.

   Client-safe: pure data and pure functions, no node built-ins. The
   packs are the other half of this and are not, because they hold
   payloads — see pack-seed.ts.
   ============================================================ */

import type { EmployerProfile } from "./employer";
import { CONSOLE_OPERATOR } from "./seed";

/** did:web:idara.app:o:<slug> — the organisation namespace. */
export const BRIGHTWATER_DID = "did:web:idara.app:o:brightwater";

/**
 * The casual agreement both sides sign.
 *
 * A single version, and the worker's pack must match it exactly —
 * agreementCompatible() refuses to guess that a newer template is compatible
 * with an older one, because that is a judgement about legal text rather than
 * about a version string.
 */
export const AGREEMENT_TEMPLATE = "casual-higa-v1";

export const EMPLOYERS: EmployerProfile[] = [
  {
    did: BRIGHTWATER_DID,
    abn: "51 824 753 556",
    legalName: "Brightwater Hospitality Group Pty Ltd",
    tradingName: "Brightwater Hospitality",
    siteIds: [
      "s-brightwater",
      "s-brightwater-gaming",
      "s-northside",
      "s-quayside",
      "s-werribee-wedding",
      "s-docklands-lunch",
    ],
    /* Connected to the demo payroll rather than left empty. A venue with no
       payroll connected cannot employ anybody, and a seed that shipped in that
       state would present the whole feature as broken on first load. */
    payroll: { connector: "mock", tenantRef: "brightwater-demo", connectedAt: "2024-04-02" },
    timeClock: { connector: "connecteam", timeClockId: "ct-brightwater" },
    workersComp: {
      insurer: "WorkSafe Victoria",
      policyRef: "WSV-4471-2024",
      expiresAt: "2027-06-30",
    },
    awardMode: "higa",
    classifications: {
      "Bartender": { level: 2, stream: "food_and_beverage" },
      "Bar Attendant": { level: 2, stream: "food_and_beverage" },
      "Wait Staff": { level: 2, stream: "food_and_beverage" },
      "Gaming Attendant": { level: 2, stream: "food_and_beverage" },
      "Barback": { level: 1, stream: "food_and_beverage" },
      "Events Coordinator": { level: 3, stream: "administration" },
      "Duty Manager": { level: 5, stream: "managerial" },
      "Venue Manager": { level: 5, stream: "managerial" },
      "Head Chef": { level: 5, stream: "kitchen" },
    },
    agreementTemplateVersion: AGREEMENT_TEMPLATE,
    /* The venue signs once, in advance, and the signatory is named. An
       engagement countersigned by "the venue" would be countersigned by
       nobody; this is the person who stands behind every one of them. */
    signatoryDid: CONSOLE_OPERATOR.did,
    signatoryName: CONSOLE_OPERATOR.name,
    acceptsPacks: true,
  },
];

const byDid = new Map(EMPLOYERS.map((e) => [e.did, e]));

export function employerOf(did: string): EmployerProfile | undefined {
  return byDid.get(did);
}

/**
 * Which employer runs this site.
 *
 * Returns undefined rather than falling back to the only employer in the
 * seed. A site nobody has claimed is a real state — a venue in the directory
 * that has not onboarded — and defaulting it would propose an engagement
 * naming an employer that never agreed to employ anybody there.
 */
export function employerForSite(siteId: string): EmployerProfile | undefined {
  return EMPLOYERS.find((e) => e.siteIds.includes(siteId));
}
