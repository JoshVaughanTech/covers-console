/* ============================================================
   Idara — construction demo dataset
   Workers, their credentials, and sites. Deliberately mixed:
   some workers are fully eligible, some carry expiring creds,
   some are blocked (missing/expired/revoked) — so the engine
   and the Publish gate have something real to enforce.

   TODAY is the demo clock; it lines up with the date pills in
   the console chrome so decisions are deterministic.
   ============================================================ */

import type { AuditEvent, Credential, Identity, Site } from "./types";
import { BASE_REQUIREMENTS } from "./construction";
import { appendEvent, type NewAuditEvent } from "./audit";

export const TODAY = "2024-05-16";

const ORG = "BrightBuild Co.";

/* ---------- issuers (did:web) ---------- */
export const ISSUERS = {
  idara: "did:web:idara.app", // self-issued after manual check (inductions, SWMS)
  regulator: "did:web:safework.vic.gov.au", // White Card, HRW licences
  rto: "did:web:trainsafe.rto.au", // First Aid, Heights, EWP
} as const;

/* ---------- sites ---------- */
export const SITES: Site[] = [
  {
    id: "s-melbourne",
    name: "Melbourne Site",
    region: "Victoria",
    requires: BASE_REQUIREMENTS,
  },
  {
    id: "s-port-melbourne",
    name: "Port Melbourne",
    region: "Victoria",
    // fall-risk site: heights ticket on top of the baseline
    requires: [...BASE_REQUIREMENTS, { type: "working_at_heights" }],
  },
  {
    id: "s-geelong",
    name: "Geelong Site",
    region: "Victoria",
    requires: BASE_REQUIREMENTS,
  },
];

/* ---------- workers ---------- */
export const WORKERS: Identity[] = [
  { did: "did:web:idara.app:w:darie-roberts", name: "Darie Roberts", role: "Carpenter", org: ORG },
  { did: "did:web:idara.app:w:leanne-vidal", name: "Leanne Vidal", role: "Electrician", org: ORG },
  { did: "did:web:idara.app:w:mitch-egan", name: "Mitch Egan", role: "Concreter", org: ORG },
  { did: "did:web:idara.app:w:aaron-patel", name: "Aaron Patel", role: "Carpenter", org: ORG },
  { did: "did:web:idara.app:w:sophie-nguyen", name: "Sophie Nguyen", role: "Site Supervisor", org: ORG },
  { did: "did:web:idara.app:w:jake-morrison", name: "Jake Morrison", role: "Carpenter", org: ORG },
  { did: "did:web:idara.app:w:hassan-ali", name: "Hassan Ali", role: "Steel Fixer", org: ORG },
  { did: "did:web:idara.app:w:liam-obrien", name: "Liam O'Brien", role: "Labourer", org: ORG },
  { did: "did:web:idara.app:w:priya-sharma", name: "Priya Sharma", role: "Project Coordinator", org: ORG },
  { did: "did:web:idara.app:w:michael-tan", name: "Michael Tan", role: "Electrician", org: ORG },
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
   Outcomes against Melbourne Site (white_card + site_induction@melbourne + first_aid):
     Darie, Aaron, Sophie, Priya  → eligible
     Leanne                       → eligible, First Aid expiring (warn)
     Mitch, Hassan                → eligible at Melbourne (Hassan blocked at Port: no heights)
     Jake                         → blocked: First Aid expired
     Liam                         → blocked: no Melbourne induction
     Michael                      → blocked: White Card revoked
*/
export const CREDENTIALS: Credential[] = [
  // Darie — clean
  cred(W["Darie Roberts"], "white_card", ISSUERS.regulator, null, { claims: { card: "WC-884201" } }),
  cred(W["Darie Roberts"], "site_induction", ISSUERS.idara, "2024-11-01", { claims: { siteId: "s-melbourne" } }),
  cred(W["Darie Roberts"], "first_aid", ISSUERS.rto, "2026-03-01"),

  // Leanne — First Aid expiring within the warning window
  cred(W["Leanne Vidal"], "white_card", ISSUERS.regulator, null, { claims: { card: "WC-220778" } }),
  cred(W["Leanne Vidal"], "site_induction", ISSUERS.idara, "2024-10-12", { claims: { siteId: "s-melbourne" } }),
  cred(W["Leanne Vidal"], "first_aid", ISSUERS.rto, "2024-06-03"),

  // Mitch — Port Melbourne ready (has heights)
  cred(W["Mitch Egan"], "white_card", ISSUERS.regulator, null, { claims: { card: "WC-551119" } }),
  cred(W["Mitch Egan"], "site_induction", ISSUERS.idara, "2024-12-01", { claims: { siteId: "s-port-melbourne" } }),
  cred(W["Mitch Egan"], "site_induction", ISSUERS.idara, "2024-12-01", { claims: { siteId: "s-melbourne" } }),
  cred(W["Mitch Egan"], "first_aid", ISSUERS.rto, "2025-09-01"),
  cred(W["Mitch Egan"], "working_at_heights", ISSUERS.rto, "2025-08-01"),

  // Aaron — clean
  cred(W["Aaron Patel"], "white_card", ISSUERS.regulator, null, { claims: { card: "WC-905482" } }),
  cred(W["Aaron Patel"], "site_induction", ISSUERS.idara, "2024-10-20", { claims: { siteId: "s-melbourne" } }),
  cred(W["Aaron Patel"], "first_aid", ISSUERS.rto, "2025-12-01"),

  // Sophie — supervisor, clean + heights
  cred(W["Sophie Nguyen"], "white_card", ISSUERS.regulator, null, { claims: { card: "WC-332901" } }),
  cred(W["Sophie Nguyen"], "site_induction", ISSUERS.idara, "2025-01-10", { claims: { siteId: "s-melbourne" } }),
  cred(W["Sophie Nguyen"], "first_aid", ISSUERS.rto, "2026-01-01"),
  cred(W["Sophie Nguyen"], "working_at_heights", ISSUERS.rto, "2025-07-01"),

  // Jake — First Aid expired → BLOCKED
  cred(W["Jake Morrison"], "white_card", ISSUERS.regulator, null, { claims: { card: "WC-660224" } }),
  cred(W["Jake Morrison"], "site_induction", ISSUERS.idara, "2024-09-30", { claims: { siteId: "s-melbourne" } }),
  cred(W["Jake Morrison"], "first_aid", ISSUERS.rto, "2023-11-01"),

  // Hassan — no Melbourne induction issue? has it; lacks heights → blocked only at Port
  cred(W["Hassan Ali"], "white_card", ISSUERS.regulator, null, { claims: { card: "WC-778116" } }),
  cred(W["Hassan Ali"], "site_induction", ISSUERS.idara, "2024-10-05", { claims: { siteId: "s-melbourne" } }),
  cred(W["Hassan Ali"], "first_aid", ISSUERS.rto, "2025-05-20"),

  // Liam — no Melbourne induction → BLOCKED
  cred(W["Liam O'Brien"], "white_card", ISSUERS.regulator, null, { claims: { card: "WC-220119" } }),
  cred(W["Liam O'Brien"], "first_aid", ISSUERS.rto, "2025-02-01"),

  // Priya — clean
  cred(W["Priya Sharma"], "white_card", ISSUERS.regulator, null, { claims: { card: "WC-887440" } }),
  cred(W["Priya Sharma"], "site_induction", ISSUERS.idara, "2025-02-15", { claims: { siteId: "s-melbourne" } }),
  cred(W["Priya Sharma"], "first_aid", ISSUERS.rto, "2026-02-01"),

  // Michael — White Card revoked → BLOCKED
  cred(W["Michael Tan"], "white_card", ISSUERS.regulator, null, { status: "revoked", claims: { card: "WC-003558" } }),
  cred(W["Michael Tan"], "site_induction", ISSUERS.idara, "2024-11-20", { claims: { siteId: "s-melbourne" } }),
  cred(W["Michael Tan"], "first_aid", ISSUERS.rto, "2025-10-01"),
];

/* ---------- seed audit history ----------
   A short, already-chained history so the Audit Log isn't empty on
   load. Note the revocation of Michael's White Card on 2024-05-10 —
   it's the recorded reason he's blocked in today's roster. Live
   publish/block events append on top of this chain. */
const SEED_AUDIT_EVENTS: NewAuditEvent[] = [
  {
    type: "credential.issued",
    at: "2024-01-15",
    actor: "Idara",
    subject: W["Darie Roberts"],
    summary: "White Card issued — Darie Roberts",
    data: { type: "white_card", issuer: ISSUERS.regulator },
  },
  {
    type: "credential.issued",
    at: "2024-02-01",
    actor: "Sophie Nguyen",
    subject: W["Aaron Patel"],
    summary: "Site Induction issued — Aaron Patel",
    data: { type: "site_induction", siteId: "s-melbourne" },
  },
  {
    type: "roster.published",
    at: "2024-05-05",
    actor: "Emma Taylor",
    summary: "Roster published for Melbourne Site — 6 workers, all eligible",
    data: { siteId: "s-melbourne", eligible: 6, published: true },
  },
  {
    type: "credential.revoked",
    at: "2024-05-10",
    actor: "Sophie Nguyen",
    subject: W["Michael Tan"],
    summary: "White Card revoked — Michael Tan",
    data: { type: "white_card", reason: "Regulator suspension notice" },
  },
  {
    type: "credential.issued",
    at: "2024-05-14",
    actor: "Idara",
    subject: W["Priya Sharma"],
    summary: "First Aid issued — Priya Sharma",
    data: { type: "first_aid", issuer: ISSUERS.rto },
  },
];

export const SEED_AUDIT: AuditEvent[] = SEED_AUDIT_EVENTS.reduce(
  (log, ev) => appendEvent(log, ev),
  [] as AuditEvent[],
);
