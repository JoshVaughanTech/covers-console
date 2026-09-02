/* ============================================================
   Idara — hospitality demo dataset
   Staff, their credentials, and the locations they work.
   Deliberately mixed: some are fully eligible, some carry
   expiring creds, some are blocked (missing/expired/revoked) —
   so the engine and the Publish gate have something real to
   enforce.

   Locations cover both halves of the industry: four fixed venues
   (including a separately-licensed gaming room) and two
   off-premise catering operations. The same person moves
   between them carrying the same RSA but a different induction,
   which is the portability argument in miniature.

   Requirements are role-scoped: RSA binds to whoever serves
   alcohol, food handling to whoever touches food, RSG to gaming.
   Hassan Ali is the proof — a Head Chef holding no RSA who is
   still eligible, because the licence was never owed by the
   kitchen.

   TODAY is the demo clock; it lines up with the date pills in
   the console chrome so decisions are deterministic.
   ============================================================ */

import type { AuditEvent, Credential, Identity, Site } from "./types";
import { BASE_REQUIREMENTS } from "./hospitality";
import { appendEvent, type NewAuditEvent } from "./audit";

export const TODAY = "2024-05-16";

const ORG = "Brightwater Hospitality";

/* ---------- issuers (did:web) ---------- */
export const ISSUERS = {
  idara: "did:web:idara.app", // self-issued after manual check (inductions, briefings)
  liquor: "did:web:liquor.vic.gov.au", // RSA
  gaming: "did:web:vgccc.vic.gov.au", // RSG
  rto: "did:web:hospotraining.rto.au", // food handling, FSS, allergen, first aid
  screening: "did:web:workingwithchildren.vic.gov.au", // WWCC
} as const;

/* ---------- locations ----------
   Fixed venues and off-premise operations are the same thing to
   the engine: a place with its own eligibility rules. */
export const SITES: Site[] = [
  {
    id: "s-brightwater",
    name: "Brightwater Hotel",
    region: "Fitzroy",
    requires: BASE_REQUIREMENTS,
  },
  {
    id: "s-brightwater-gaming",
    name: "Brightwater Gaming Room",
    region: "Fitzroy",
    // Same building as the hotel, separately licensed — RSG on top, and
    // deliberately NOT role-scoped: being rostered into the gaming room is
    // itself the gaming duty, whatever the person's usual title. Where a
    // location implies the duty, the location scopes the requirement; role
    // scoping is for requirements that differ between people at one place.
    requires: [...BASE_REQUIREMENTS, { type: "rsg" }],
  },
  {
    id: "s-northside",
    name: "Northside Tavern",
    region: "Brunswick",
    // full kitchen: supervised food handling
    requires: [...BASE_REQUIREMENTS, { type: "food_safety_supervisor", appliesTo: ["handle_food"] }],
  },
  {
    id: "s-quayside",
    name: "Quayside Bar & Kitchen",
    region: "Docklands",
    requires: BASE_REQUIREMENTS,
  },
  {
    id: "s-werribee-wedding",
    name: "Werribee Park Wedding",
    region: "Off-premise",
    // plated event, declared dietaries, food transported to site
    requires: [
      ...BASE_REQUIREMENTS,
      { type: "allergen_management", appliesTo: ["handle_food"] },
      { type: "food_safety_supervisor", appliesTo: ["handle_food"] },
    ],
  },
  {
    id: "s-docklands-lunch",
    name: "Docklands Corporate Lunch",
    region: "Off-premise",
    requires: [...BASE_REQUIREMENTS, { type: "allergen_management", appliesTo: ["handle_food"] }],
  },
];

/* ---------- staff ---------- */
export const WORKERS: Identity[] = [
  { did: "did:web:idara.app:w:darie-roberts", name: "Darie Roberts", role: "Bartender", org: ORG },
  { did: "did:web:idara.app:w:leanne-vidal", name: "Leanne Vidal", role: "Duty Manager", org: ORG },
  { did: "did:web:idara.app:w:mitch-egan", name: "Mitch Egan", role: "Gaming Attendant", org: ORG },
  { did: "did:web:idara.app:w:aaron-patel", name: "Aaron Patel", role: "Bartender", org: ORG },
  { did: "did:web:idara.app:w:sophie-nguyen", name: "Sophie Nguyen", role: "Venue Manager", org: ORG },
  { did: "did:web:idara.app:w:jake-morrison", name: "Jake Morrison", role: "Bar Attendant", org: ORG },
  { did: "did:web:idara.app:w:hassan-ali", name: "Hassan Ali", role: "Head Chef", org: ORG },
  { did: "did:web:idara.app:w:liam-obrien", name: "Liam O'Brien", role: "Barback", org: ORG },
  { did: "did:web:idara.app:w:priya-sharma", name: "Priya Sharma", role: "Functions Coordinator", org: ORG },
  { did: "did:web:idara.app:w:michael-tan", name: "Michael Tan", role: "Wait Staff", org: ORG },
];

const W = Object.fromEntries(WORKERS.map((w) => [w.name, w.did])) as Record<string, string>;

/* helper to cut down boilerplate */
let _n = 0;
function cred(
  subject: string,
  type: Credential["type"],
  issuer: string,
  expiresAt: string | null,
  opts: Partial<Pick<Credential, "status" | "claims" | "issuedAt">> = {},
): Credential {
  return {
    id: `vc-${(_n++).toString().padStart(3, "0")}`,
    type,
    subject,
    issuer,
    issuedAt: opts.issuedAt ?? "2023-01-15",
    expiresAt,
    status: opts.status ?? "valid",
    claims: opts.claims ?? {},
  };
}

/* ---------- credentials ----------
   Outcomes against Brightwater Hotel (rsa + induction@brightwater + food_handling):
     Darie, Mitch, Aaron, Sophie, Hassan, Priya  → eligible
     Leanne                                      → eligible, RSA expiring (warn)
     Jake                                        → blocked: RSA expired
     Liam                                        → blocked: no Brightwater induction
     Michael                                     → blocked: RSA revoked

   Cross-location:
     Darie   → blocked in the Gaming Room (inducted, but no RSG)
     Mitch   → clears hotel floor AND gaming room
     Hassan  → clears the hotel, blocked at the wedding (no allergen, no FSS)
     Priya   → clears the hotel and both catering operations
*/
export const CREDENTIALS: Credential[] = [
  // Darie — clean on the floor; inducted for gaming but holds no RSG
  cred(W["Darie Roberts"], "rsa", ISSUERS.liquor, "2026-03-01", { claims: { cert: "RSA-884201" } }),
  cred(W["Darie Roberts"], "site_induction", ISSUERS.idara, "2024-11-01", { claims: { siteId: "s-brightwater" } }),
  cred(W["Darie Roberts"], "site_induction", ISSUERS.idara, "2024-11-01", { claims: { siteId: "s-brightwater-gaming" } }),
  cred(W["Darie Roberts"], "food_handling", ISSUERS.rto, "2025-08-01"),

  // Leanne — RSA expiring within the warning window
  cred(W["Leanne Vidal"], "rsa", ISSUERS.liquor, "2024-06-03", { claims: { cert: "RSA-220778" } }),
  cred(W["Leanne Vidal"], "site_induction", ISSUERS.idara, "2024-10-12", { claims: { siteId: "s-brightwater" } }),
  cred(W["Leanne Vidal"], "food_handling", ISSUERS.rto, "2025-06-20"),
  cred(W["Leanne Vidal"], "rsg", ISSUERS.gaming, "2025-04-01", { claims: { cert: "RSG-110293" } }),

  // Mitch — gaming-room ready
  cred(W["Mitch Egan"], "rsa", ISSUERS.liquor, "2025-09-01", { claims: { cert: "RSA-551119" } }),
  cred(W["Mitch Egan"], "site_induction", ISSUERS.idara, "2024-12-01", { claims: { siteId: "s-brightwater" } }),
  cred(W["Mitch Egan"], "site_induction", ISSUERS.idara, "2024-12-01", { claims: { siteId: "s-brightwater-gaming" } }),
  cred(W["Mitch Egan"], "food_handling", ISSUERS.rto, "2025-07-15"),
  cred(W["Mitch Egan"], "rsg", ISSUERS.gaming, "2025-08-01", { claims: { cert: "RSG-448120" } }),

  // Aaron — clean
  cred(W["Aaron Patel"], "rsa", ISSUERS.liquor, "2025-12-01", { claims: { cert: "RSA-905482" } }),
  cred(W["Aaron Patel"], "site_induction", ISSUERS.idara, "2024-10-20", { claims: { siteId: "s-brightwater" } }),
  cred(W["Aaron Patel"], "site_induction", ISSUERS.idara, "2024-10-20", { claims: { siteId: "s-quayside" } }),
  cred(W["Aaron Patel"], "food_handling", ISSUERS.rto, "2025-10-01"),

  // Sophie — venue manager; carries the supervisor tickets
  cred(W["Sophie Nguyen"], "rsa", ISSUERS.liquor, "2026-01-01", { claims: { cert: "RSA-332901" } }),
  cred(W["Sophie Nguyen"], "site_induction", ISSUERS.idara, "2025-01-10", { claims: { siteId: "s-brightwater" } }),
  cred(W["Sophie Nguyen"], "site_induction", ISSUERS.idara, "2025-01-10", { claims: { siteId: "s-brightwater-gaming" } }),
  cred(W["Sophie Nguyen"], "site_induction", ISSUERS.idara, "2025-01-10", { claims: { siteId: "s-northside" } }),
  cred(W["Sophie Nguyen"], "food_handling", ISSUERS.rto, "2026-01-01"),
  cred(W["Sophie Nguyen"], "rsg", ISSUERS.gaming, "2025-07-01", { claims: { cert: "RSG-332901" } }),
  cred(W["Sophie Nguyen"], "food_safety_supervisor", ISSUERS.rto, "2027-02-01"),
  cred(W["Sophie Nguyen"], "first_aid", ISSUERS.rto, "2026-01-01"),

  // Jake — RSA expired → BLOCKED
  cred(W["Jake Morrison"], "rsa", ISSUERS.liquor, "2023-11-01", { claims: { cert: "RSA-660224" } }),
  cred(W["Jake Morrison"], "site_induction", ISSUERS.idara, "2024-09-30", { claims: { siteId: "s-brightwater" } }),
  cred(W["Jake Morrison"], "food_handling", ISSUERS.rto, "2025-03-01"),

  // Hassan — head chef, holds NO RSA and doesn't need one: the licence binds
  // to alcohol service, not to the kitchen. Inducted for the wedding, but
  // lacks the allergen and FSS tickets that off-premise catering demands.
  cred(W["Hassan Ali"], "site_induction", ISSUERS.idara, "2024-10-05", { claims: { siteId: "s-brightwater" } }),
  cred(W["Hassan Ali"], "site_induction", ISSUERS.idara, "2024-12-01", { claims: { siteId: "s-werribee-wedding" } }),
  cred(W["Hassan Ali"], "food_handling", ISSUERS.rto, "2025-11-01"),
  cred(W["Hassan Ali"], "first_aid", ISSUERS.rto, "2025-05-20"),

  // Liam — no Brightwater induction → BLOCKED
  cred(W["Liam O'Brien"], "rsa", ISSUERS.liquor, "2025-02-01", { claims: { cert: "RSA-220119" } }),
  cred(W["Liam O'Brien"], "food_handling", ISSUERS.rto, "2025-04-01"),

  // Priya — moves between the venue and both catering operations
  cred(W["Priya Sharma"], "rsa", ISSUERS.liquor, "2026-02-01", { claims: { cert: "RSA-887440" } }),
  cred(W["Priya Sharma"], "site_induction", ISSUERS.idara, "2025-02-15", { claims: { siteId: "s-brightwater" } }),
  cred(W["Priya Sharma"], "site_induction", ISSUERS.idara, "2024-12-15", { claims: { siteId: "s-werribee-wedding" } }),
  cred(W["Priya Sharma"], "site_induction", ISSUERS.idara, "2024-12-15", { claims: { siteId: "s-docklands-lunch" } }),
  cred(W["Priya Sharma"], "food_handling", ISSUERS.rto, "2026-01-15"),
  cred(W["Priya Sharma"], "allergen_management", ISSUERS.rto, "2026-03-01"),
  cred(W["Priya Sharma"], "food_safety_supervisor", ISSUERS.rto, "2027-01-01"),
  cred(W["Priya Sharma"], "wwcc", ISSUERS.screening, "2027-06-01", { claims: { cert: "WWCC-1180244" } }),

  // Michael — RSA revoked by the regulator → BLOCKED
  cred(W["Michael Tan"], "rsa", ISSUERS.liquor, "2025-10-01", { status: "revoked", claims: { cert: "RSA-003558" } }),
  cred(W["Michael Tan"], "site_induction", ISSUERS.idara, "2024-11-20", { claims: { siteId: "s-brightwater" } }),
  cred(W["Michael Tan"], "food_handling", ISSUERS.rto, "2025-09-01"),
];

/* ---------- seed audit history ----------
   A short, already-chained history so the Audit Log isn't empty on
   load. Note the revocation of Michael's RSA on 2024-05-10 — it's the
   recorded reason he's blocked in today's roster. Live publish/block
   events append on top of this chain. */
const SEED_AUDIT_EVENTS: NewAuditEvent[] = [
  {
    type: "credential.issued",
    at: "2024-01-15",
    actor: "Idara",
    subject: W["Darie Roberts"],
    summary: "RSA issued — Darie Roberts",
    data: { type: "rsa", issuer: ISSUERS.liquor },
  },
  {
    type: "credential.issued",
    at: "2024-02-01",
    actor: "Sophie Nguyen",
    subject: W["Aaron Patel"],
    summary: "Venue Induction issued — Aaron Patel",
    data: { type: "site_induction", siteId: "s-brightwater" },
  },
  {
    type: "roster.published",
    at: "2024-05-05",
    actor: "Emma Taylor",
    summary: "Roster published for Brightwater Hotel — 6 staff, all eligible",
    data: { siteId: "s-brightwater", eligible: 6, published: true },
  },
  {
    type: "credential.revoked",
    at: "2024-05-10",
    actor: "Sophie Nguyen",
    subject: W["Michael Tan"],
    summary: "RSA revoked — Michael Tan",
    data: { type: "rsa", reason: "Liquor regulator disciplinary notice" },
  },
  {
    type: "credential.issued",
    at: "2024-05-14",
    actor: "Idara",
    subject: W["Priya Sharma"],
    summary: "Allergen Management issued — Priya Sharma",
    data: { type: "allergen_management", issuer: ISSUERS.rto },
  },
];

export const SEED_AUDIT: AuditEvent[] = SEED_AUDIT_EVENTS.reduce(
  (log, ev) => appendEvent(log, ev),
  [] as AuditEvent[],
);
