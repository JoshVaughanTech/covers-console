# Design — One-tap employment: the pack, the engagement, and payroll connectors

**Date:** 5 Sep 2026 · **Status:** proposed · **Builds on:** `lib/idara`, `lib/staffing`, `lib/awards`
**Sequence:** after `lib/awards/rates.ts` (rate floors), before any native app

---

## 1. The idea in one paragraph

Supp removes hiring paperwork by removing the employment. Covers removes the paperwork by doing the
employment **once, properly, for everyone**, and making a shift a signature. Every worker holds a
verified **pack** in Idara (identity, right to work, tax, super, bank, credentials, a pre-signed
casual agreement). Every venue holds a verified **employer profile** (ABN, payroll connection,
workers' comp, award classifications, its side of the same agreement). A booking assembles an
**engagement** — this worker, this venue, this shift, this rate — that both parties accept with a
tap. Idara records it on the audit chain and pushes the worker into the venue's payroll and time
clock with every field pre-filled. The venue is the employer; the venue types nothing.

---

## 2. Decisions

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Who employs | **The venue.** Covers charges a booking fee and never touches wages. | Covers as labour-hire employer (licence, float, workers' comp) — kept as a later option; partner EOR (see §9) for venues that refuse onboarding. |
| What an engagement is | **A credential**, issued by Idara, signed by both parties, referencing the worker's pack and the venue's profile by hash. | A row in a bookings table. Rows can be edited; a credential is verifiable by an auditor without trusting Covers' database. |
| Where sensitive data lives | **In the worker's pack, encrypted, released per-engagement to the payroll the worker approved.** Covers stores the hash and a release log, not the TFN. | A central TFN table. The ATO's TFN Rule and the Privacy Act both point away from this, and it is the single worst thing to have breached. |
| Signing | **In-app acceptance is the signature**, with identity bound to the Idara DID and the acceptance event hash-chained. | Third-party e-sign (DocuSign). Extra cost, extra UX, and no stronger evidentially than a chained acceptance tied to a verified identity. Keep as an option for venues whose lawyers insist. |
| Payroll integration | **Connector interface with one method per employment act** (create employee, lodge TFN declaration, record super choice, deliver statements). First connector: the pilot venue's payroll. | Building payroll. Never. |
| Tax-free threshold | **Claimed with exactly one employer**, chosen by the worker as primary; app warns on a second claim. | Leave it to the worker. Multi-employer casuals get this wrong constantly and it surfaces as a tax bill. |
| Casual conversion | **Detected from the chain** (regular pattern with one venue approaching 6 months) and surfaced to both sides. | Ignore. It's an employer obligation the venue has just delegated its record-keeping for. |

---

## 3. The pack (worker side)

Each item is a verifiable credential in the worker's Idara wallet. `sensitivity` decides storage:
`public` items are readable by any venue the worker applies to; `restricted` items are released
only inside an engagement, to the named payroll, and logged.

```ts
type PackItemKind =
  | "identity"          // government ID verified via KYC provider; stores result, not the document
  | "right_to_work"     // VEVO check result + date, or citizenship evidence result
  | "tfn_declaration"   // answers to the ATO TFN declaration; TFN itself is `restricted`
  | "super_choice"      // fund + member no, or "use stapled fund"
  | "bank_account"      // BSB/account — `restricted`
  | "emergency_contact"
  | "casual_agreement"  // worker's signature on the standard template, versioned
  | "fwis_ack"          // Fair Work Information Statement delivered + acknowledged
  | "ceis_ack"          // Casual Employment Information Statement delivered + acknowledged
  | "credential";       // RSA / RSG / Food Safety / First Aid — existing Idara credentials

interface PackItem {
  kind: PackItemKind;
  issuer: DID;                         // Idara, a KYC provider, an RTO, the worker (self-attested)
  verifiedAt: ISODate;
  expiresAt?: ISODate;
  sensitivity: "public" | "restricted";
  hash: string;                        // sha256 of canonical payload
  payloadRef?: string;                 // pointer into encrypted store; absent for `public` inline items
  status: "valid" | "expired" | "revoked";
}

interface WorkerPack {
  did: DID;
  items: PackItem[];
  primaryEmployerDid?: DID;            // where the tax-free threshold is claimed
  agreementTemplateVersion: string;    // e.g. "casual-higa-v1"
  completeness: { ok: boolean; missing: PackItemKind[] };
}
```

Pack completeness is what the marketplace checks before a worker can accept an engagement.
Missing items are the "unlocks 4 shifts" nudge in the mockup.

---

## 4. The employer profile (venue side)

```ts
interface EmployerProfile {
  did: DID;                            // did:web:idara.app:o:<slug>
  abn: string;
  legalName: string;
  payroll: { connector: PayrollConnectorId; tenantRef: string; connectedAt: ISODate };
  timeClock?: { connector: "connecteam"; timeClockId: string };
  workersComp: { insurer: string; policyRef: string; expiresAt: ISODate };
  awardMode: "higa" | "restaurant" | "eba";   // drives lib/awards pack selection
  classifications: Record<string, { level: number; stream: string }>; // role → award level
  agreementTemplateVersion: string;    // must match worker's, or a newer compatible one
  signatoryDid: DID;                   // who pre-signed the employer side
  acceptsPacks: boolean;
}
```

---

## 5. The engagement (the credential a booking creates)

```ts
interface Engagement {
  id: string;                          // eng-<ulid>
  workerDid: DID;
  employerDid: DID;
  postingId: string;                   // from lib/staffing
  shift: { siteId: string; date: ISODate; start: string; end: string; role: string };
  pay: {
    classification: { level: number; stream: string };
    baseRate: number;                  // from lib/awards/rates.ts floorRate()
    offeredRate: number;               // >= baseRate, enforced
    loadings: string[];                // e.g. ["casual_25", "saturday"]
    superRate: number;                 // 0.12
  };
  employment: {
    firstEngagementWithEmployer: boolean;   // triggers payroll create + statements
    claimsTaxFreeThreshold: boolean;        // true only if employerDid === pack.primaryEmployerDid
    agreementTemplateVersion: string;
  };
  packSnapshot: { itemHashes: Record<PackItemKind, string> };  // what was true at signing
  employerProfileHash: string;
  acceptance: {
    worker: { at: string; eventHash: string } | null;
    employer: { at: string; eventHash: string; byDid: DID } | null;
  };
  releases: { item: PackItemKind; toConnector: PayrollConnectorId; at: string }[];
  status: "proposed" | "accepted" | "provisioned" | "worked" | "confirmed" | "cancelled";
}
```

An engagement is **accepted** when both `acceptance` sides are present; **provisioned** when the
payroll connector has done its work; **worked** when the time clock shows a completed shift;
**confirmed** when the venue confirms hours (or 48h auto-confirm). Each transition is an audit event.

---

## 6. Flow

```
Worker onboards ──► pack complete ──► can apply/accept
Venue onboards ──► profile complete, payroll connected ──► acceptsPacks

Booking confirmed (staffing.assign / approveClaim)
  └► idara.proposeEngagement(posting, workerDid)
       ├─ rate check: offeredRate >= floorRate(...)            [lib/awards/rates]
       ├─ eligibility: decide(worker, "be_rostered", site)      [lib/idara]
       ├─ pack completeness; agreement version compatibility
       └─ threshold: claimsTaxFreeThreshold = (employer === primary)
  worker taps Accept  ──► acceptance.worker  ──► audit: engagement.accepted (worker)
  employer approval   ──► acceptance.employer ──► audit: engagement.accepted (employer)
  both present        ──► status accepted
  └► provision(engagement)
       ├─ if firstEngagementWithEmployer:
       │    connector.createEmployee(pack → payload)        releases: identity, bank, super, contact
       │    connector.lodgeTfnDeclaration(pack.tfn)         release: tfn (restricted)
       │    connector.recordSuperChoice(...)
       │    connector.deliverStatements(["fwis","ceis"])    ack already in pack; record delivery
       │    timeClock.createUser(...)                       Connecteam
       └─ else: timeClock.assignShift(...)
       └► status provisioned; audit: engagement.provisioned {connector, items released}
  shift runs ──► Break Board sees the worker like any casual
  hours confirmed ──► status confirmed; audit: engagement.confirmed {hours, breaks, loading}
  Covers invoices employer: bookingFee = offeredRate × hours × 0.09
```

Second engagement with the same employer skips the `firstEngagementWithEmployer` branch entirely.

---

## 7. Payroll connector interface

```ts
type PayrollConnectorId = "xero" | "keypay" | "employment_hero" | "myob" | "connecteam_payroll";

interface PayrollConnector {
  id: PayrollConnectorId;
  connect(tenantRef: string, oauth: OAuthGrant): Promise<void>;
  createEmployee(input: NewEmployee): Promise<{ externalId: string }>;
  lodgeTfnDeclaration(externalId: string, decl: TfnDeclaration): Promise<void>;   // via STP
  recordSuperChoice(externalId: string, choice: SuperChoice): Promise<void>;
  deliverStatements(externalId: string, docs: ("fwis" | "ceis")[]): Promise<void>;
  findEmployee(query: { email?: string; did?: DID }): Promise<{ externalId: string } | null>;
}
```

Rules:
- Connectors receive **decrypted payloads only inside `provision()`**, never persist them, and every
  call is logged as a `release` on the engagement.
- Idempotent: `findEmployee` before `createEmployee`; re-running provision is safe.
- One connector per pilot. Do not build three at once.

---

## 8. Audit events (add to `AuditEventType`)

`engagement.proposed` · `engagement.accepted` (data: `{ side: "worker" | "employer" }`) ·
`engagement.provisioned` (data: `{ connector, released: PackItemKind[] }`) · `engagement.confirmed` ·
`engagement.cancelled` · `pack.item_verified` · `pack.item_revoked` · `conversion.flagged`.

`/audit` gets cases for each; an auditor can open any engagement and see the pack hashes that were
valid at signing, which connector received what, and when hours were confirmed.

---

## 9. Partner EOR path (for venues that will not onboard)

Same engagement, different `employerDid`: a licensed labour-hire partner is the employer, the venue
is recorded as `host`. Provisioning targets the partner's payroll; the venue's Connecteam still gets
the user. Pricing shows wage + partner on-costs + partner margin + Covers fee. This is a config
branch, not a second product — but it needs a signed partner agreement before it's switched on.

---

## 10. Privacy & safety requirements

- TFN, bank, ID document results: encrypted at rest with a per-worker key; decrypt only in
  `provision()`; never logged; never in analytics.
- Workers can see every release (which venue, which connector, when) and revoke future releases.
- Deleting a worker: tombstone pack items (hash stays on chain; payload destroyed).
- The employer sees `public` items and *that* restricted items are verified, not their contents,
  until provisioning delivers them to *their own* payroll.
- KYC provider choice is a P0 for this feature (Stripe Identity / Onfido / GreenID); we store results,
  not documents.

---

## 11. Build order

1. `lib/awards/rates.ts` — floor rates (prerequisite; engagement.pay depends on it).
2. `lib/idara/pack.ts` — types above, completeness check, item hashing; seed packs for demo workers.
3. `lib/idara/engagement.ts` — propose / accept / provision state machine, pure; audit events.
4. `lib/payroll/` — connector interface + `mock` connector; then one real connector for the pilot venue.
5. Screens: worker pack progress (mobile web `/me/pack`), engagement accept sheet (`/me/shifts`),
   employer profile + payroll connect (`/settings/employer`), engagement detail in `/audit`.
6. Tests: pack completeness, threshold rule, rate enforcement, provisioning idempotency, release log.

Out of scope for v1: multiple agreement templates, EBA-specific templates, contractor engagements.
