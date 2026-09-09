/* ============================================================
   Idara — demo employment packs.

   Ten packs for the ten seeded workers, deliberately uneven in the
   same way the credential seed is: most complete, some short, one
   lapsed. A seed where everybody is ready proves nothing — the
   refusals are the part of this feature that has to be seen
   working, because they are what stops somebody being employed on
   an incomplete record.

     Darie, Mitch, Sophie, Hassan, Priya, Michael → complete
     Leanne  → complete, but claims the threshold with another
               employer, so this venue withholds at the higher rate
     Aaron   → complete, threshold not nominated anywhere yet
     Jake    → right-to-work check lapsed → pack incomplete
     Liam    → no tax declaration, no super choice → pack incomplete

   Michael's pack is deliberately complete while his RSA is revoked.
   The two layers answer different questions — the pack says whether
   he can be employed, the engine says whether he can work this
   shift — and a demo where the same people fail both would let them
   be confused for one check.

   SERVER ONLY. Restricted payloads go through the vault, which
   reaches node:crypto, so this file must never be imported from a
   client component. The employer half (employer-seed.ts) is pure
   data and is safe anywhere.

   Every tax file number here is invalid by the ATO's own algorithm:
   the weighted checksum of 000 000 00N never divides by 11 for N in
   1–9. A fixture that happened to be a real person's TFN is a thing
   that should be impossible by construction rather than by luck.
   ============================================================ */

import { packItem, type PackItem, type WorkerPack } from "./pack";
import { packVault, type PackVault } from "./vault";
import { AGREEMENT_TEMPLATE, BRIGHTWATER_DID } from "./employer-seed";
import { ISSUERS, WORKERS } from "./seed";
import type { DID } from "./types";

/** A second employer, existing only so "your primary is elsewhere" is real. */
export const OTHER_EMPLOYER_DID = "did:web:idara.app:o:portside-group";

const KYC_ISSUER = "did:web:stripe.com:identity";
const HOME_AFFAIRS = "did:web:homeaffairs.gov.au";
const FWO = "did:web:fairwork.gov.au";

interface Deviation {
  /** kinds this worker simply does not hold. */
  without?: ("tfn_declaration" | "super_choice" | "bank_account" | "emergency_contact")[];
  /** an expired right-to-work check instead of a current one. */
  rightToWork?: { basis: "citizen" | "visa"; expiresAt?: string };
  primaryEmployerDid?: DID | null;
}

const DEVIATIONS: Record<string, Deviation> = {
  "Leanne Vidal": { primaryEmployerDid: OTHER_EMPLOYER_DID },
  // has not nominated anywhere — a real state, and not the same as claiming
  "Aaron Patel": { primaryEmployerDid: null },
  "Jake Morrison": {
    // 482 visa, VEVO check taken last year and lapsed before today
    rightToWork: { basis: "visa", expiresAt: "2024-04-30" },
  },
  "Liam O'Brien": { without: ["tfn_declaration", "super_choice"] },
};

const SUBURBS = [
  { suburb: "Fitzroy", postcode: "3065" },
  { suburb: "Brunswick", postcode: "3056" },
  { suburb: "Docklands", postcode: "3008" },
  { suburb: "Northcote", postcode: "3070" },
  { suburb: "Yarraville", postcode: "3013" },
];

const FUNDS = [
  { fundName: "Hostplus", usi: "HOS0100AU" },
  { fundName: "AustralianSuper", usi: "STA0100AU" },
  { fundName: "Rest Super", usi: "RES0103AU" },
];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, ".");

/**
 * Build every demo pack, storing the restricted halves in the vault.
 *
 * Takes the vault rather than reaching for the singleton, so a test can hand
 * it a fresh one and assert on exactly what was stored — and so nothing here
 * can quietly write to the process-wide vault as a side effect of an import.
 */
export function buildPacks(vault: PackVault): Map<DID, WorkerPack> {
  const packs = new Map<DID, WorkerPack>();
  let tfnSeq = 0;

  WORKERS.forEach((worker, i) => {
    const dev = DEVIATIONS[worker.name] ?? {};
    const without = new Set(dev.without ?? []);
    const [firstName, ...rest] = worker.name.split(" ");
    const lastName = rest.join(" ");
    const email = `${slug(worker.name)}@example.com`;
    const place = SUBURBS[i % SUBURBS.length];
    const items: PackItem[] = [];

    const put = (kind: Parameters<PackVault["put"]>[1], payload: Record<string, unknown>) =>
      vault.put(worker.did, kind, payload);

    /* Identity — the KYC RESULT, never the document. What is stored is that a
       provider checked a licence on a date and it matched; the scan itself is
       the provider's problem and is not ours to hold. */
    const identity = {
      firstName,
      lastName,
      email,
      phone: `+6141${String(1000000 + i * 13571).slice(0, 7)}`,
      dateOfBirth: `199${i % 10}-0${(i % 9) + 1}-1${(i % 8) + 1}`,
      address: {
        line1: `${12 + i * 7} Gertrude Street`,
        suburb: place.suburb,
        state: "VIC",
        postcode: place.postcode,
        country: "AU",
      },
      documentType: "drivers_licence",
      checkRef: `kyc-${String(1000 + i)}`,
      outcome: "match",
    };
    items.push(
      packItem({
        kind: "identity",
        issuer: KYC_ISSUER,
        verifiedAt: "2024-03-04",
        payload: identity,
        payloadRef: put("identity", identity),
      }),
    );

    const rtw = dev.rightToWork ?? { basis: "citizen" as const };
    items.push(
      packItem({
        kind: "right_to_work",
        issuer: rtw.basis === "citizen" ? ISSUERS.idara : HOME_AFFAIRS,
        verifiedAt: "2024-03-04",
        ...(rtw.expiresAt ? { expiresAt: rtw.expiresAt } : {}),
        // public: a venue may see THAT somebody may work, and on what basis.
        // It is the one restricted-feeling fact that an employer is entitled
        // to hold, because employing without it is the employer's offence
        payload: {
          basis: rtw.basis,
          ...(rtw.basis === "visa" ? { subclass: "482", vevoRef: `VEVO-${1000 + i}` } : {}),
          outcome: "may_work",
        },
      }),
    );

    if (!without.has("tfn_declaration")) {
      tfnSeq++;
      const decl = {
        tfn: `000 000 00${tfnSeq}`,
        residencyStatus: "resident",
        hasStudyAndTrainingLoan: i % 3 === 0,
      };
      items.push(
        packItem({
          kind: "tfn_declaration",
          // self-attested: the worker declares it, the payroll lodges it, the
          // ATO validates it. Nobody in between verifies a TFN
          issuer: worker.did,
          verifiedAt: "2024-03-05",
          payload: decl,
          payloadRef: put("tfn_declaration", decl),
        }),
      );
    }

    if (!without.has("super_choice")) {
      const fund = FUNDS[i % FUNDS.length];
      const choice =
        i % 4 === 3
          ? { kind: "stapled" }
          : { kind: "chosen_fund", ...fund, memberNumber: `M${String(4400000 + i * 37)}` };
      items.push(
        packItem({
          kind: "super_choice",
          issuer: worker.did,
          verifiedAt: "2024-03-05",
          payload: choice,
          payloadRef: put("super_choice", choice),
        }),
      );
    }

    if (!without.has("bank_account")) {
      const bank = {
        bsb: `06${String(300 + i).slice(0, 3)}`,
        accountNumber: String(10045000 + i * 911),
        accountName: worker.name,
      };
      items.push(
        packItem({
          kind: "bank_account",
          issuer: worker.did,
          verifiedAt: "2024-03-05",
          payload: bank,
          payloadRef: put("bank_account", bank),
        }),
      );
    }

    if (!without.has("emergency_contact")) {
      const contact = {
        name: ["Sam Okafor", "Jo Whitfield", "Alex Marek", "Robin Lai"][i % 4],
        relationship: ["Partner", "Parent", "Sibling", "Friend"][i % 4],
        phone: `+6142${String(2000000 + i * 7919).slice(0, 7)}`,
      };
      items.push(
        packItem({
          kind: "emergency_contact",
          issuer: worker.did,
          verifiedAt: "2024-03-06",
          payload: contact,
          payloadRef: put("emergency_contact", contact),
        }),
      );
    }

    items.push(
      packItem({
        kind: "casual_agreement",
        issuer: worker.did,
        verifiedAt: "2024-03-06",
        payload: { template: AGREEMENT_TEMPLATE, signedAt: "2024-03-06T09:14:00+10:00" },
      }),
      packItem({
        kind: "fwis_ack",
        issuer: FWO,
        verifiedAt: "2024-03-06",
        payload: { version: "2024-07", acknowledgedAt: "2024-03-06T09:15:00+10:00" },
      }),
      packItem({
        kind: "ceis_ack",
        issuer: FWO,
        verifiedAt: "2024-03-06",
        payload: { version: "2024-07", acknowledgedAt: "2024-03-06T09:15:20+10:00" },
      }),
      packItem({
        kind: "credential",
        // a pointer, not a copy. The tickets are already verifiable in the
        // Idara wallet, and a second record of them here could disagree
        issuer: ISSUERS.idara,
        verifiedAt: "2024-03-06",
        payload: { source: "idara_wallet", subject: worker.did },
      }),
    );

    const primary =
      dev.primaryEmployerDid === null ? undefined : (dev.primaryEmployerDid ?? BRIGHTWATER_DID);

    packs.set(worker.did, {
      did: worker.did,
      items,
      ...(primary ? { primaryEmployerDid: primary } : {}),
      agreementTemplateVersion: AGREEMENT_TEMPLATE,
    });
  });

  return packs;
}

/* One set of packs per process, built against the process's vault. Cached on
   globalThis for the same reason the vault is: Next reloads modules in dev,
   and a rebuilt pack would point at payloadRefs the vault no longer holds —
   provisioning would fail with "no vault payload", which reads as a bug in
   the crypto rather than as two modules disagreeing about which copy is live. */
const KEY = Symbol.for("covers.packs");
type Holder = { [KEY]?: Map<DID, WorkerPack> };

export function packs(): Map<DID, WorkerPack> {
  const g = globalThis as unknown as Holder;
  return (g[KEY] ??= buildPacks(packVault()));
}

export function packOf(did: DID): WorkerPack | undefined {
  return packs().get(did);
}
