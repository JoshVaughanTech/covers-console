/* ============================================================
   Idara — the worker's employment pack.

   The pack is the thing that makes a shift a signature. Every fact
   an employer needs before it can put somebody on payroll — who
   they are, that they may work, their TFN declaration, their fund,
   their account, the statements the Fair Work Act says they must be
   handed — is verified ONCE, held by the worker, and released per
   engagement to the payroll they approved.

   Two rules hold the whole thing up, and both are structural here
   rather than conventions somebody has to remember.

   1. SENSITIVITY IS A PROPERTY OF THE KIND, NOT OF THE ITEM.
      A TFN is restricted because it is a TFN. If each item carried
      its own authored sensitivity, one row written `public` by a
      bug, a bad import or a helpful default would publish a tax
      file number to every venue the worker ever applied to, and
      nothing about that row would look wrong. So the table below
      is the authority and packItem() stamps the value; the field
      stays on the item because a released or exported item must
      still say what it is, but nothing may author it.

   2. COMPLETENESS IS COMPUTED, NEVER STORED.
      A `complete: true` flag and an expired right-to-work check can
      disagree, and the flag is the one the marketplace would read.
      completenessOf() is a fold over the items as they stand today,
      so the answer cannot go stale between the check and the shift.

   What is NOT here: the payload. This module holds hashes, kinds,
   validity and pointers. The bytes of a TFN live in the vault
   (vault.ts), are decrypted only inside provision(), and never
   reach a screen, a log or an analytics event. See §10 of
   docs/plans/2026-09-05-one-tap-employment-design.md.
   ============================================================ */

import { canonicalJson, sha256Hex } from "./hash";
import { calendarDate, isBeforeDay } from "./dates";
import { daysBetween } from "./standing";
import type { DID, ISODate } from "./types";

/* ---------- what a pack is made of ---------- */

export type PackItemKind =
  /** government ID verified via a KYC provider; stores the RESULT, not the document. */
  | "identity"
  /** VEVO check result + date, or citizenship evidence result. */
  | "right_to_work"
  /** answers to the ATO TFN declaration; the number itself is restricted. */
  | "tfn_declaration"
  /** fund + member number, or "use my stapled fund". */
  | "super_choice"
  /** BSB + account. */
  | "bank_account"
  | "emergency_contact"
  /** the worker's signature on the standard casual agreement, versioned. */
  | "casual_agreement"
  /** Fair Work Information Statement delivered + acknowledged. */
  | "fwis_ack"
  /** Casual Employment Information Statement delivered + acknowledged. */
  | "ceis_ack"
  /** RSA / RSG / food safety / first aid — the Idara credentials, already verified. */
  | "credential";

export type PackItemSensitivity = "public" | "restricted";

export type PackItemStatus = "valid" | "expired" | "revoked";

export interface PackItemMeta {
  kind: PackItemKind;
  label: string;
  /** one line, written for the worker rather than for a schema. */
  blurb: string;
  sensitivity: PackItemSensitivity;
  /**
   * Whether a pack without it can accept an engagement.
   *
   * `credential` is the only optional kind, and deliberately: which tickets a
   * job needs is a question about the shift, answered by the engine against
   * the site's requirements. A pack that demanded every credential would
   * refuse a head chef for holding no RSA.
   */
  required: boolean;
  /** who attests it — shown so "verified" names an authority rather than us. */
  verifiedBy: string;
}

/**
 * The taxonomy. Order is the order the pack screen walks somebody through:
 * identity first because everything else hangs off it, the statements last
 * because they are an acknowledgement rather than a task.
 */
export const PACK_ITEMS: readonly PackItemMeta[] = [
  {
    kind: "identity",
    label: "Identity",
    blurb: "Government ID, checked once by a KYC provider.",
    sensitivity: "restricted",
    required: true,
    verifiedBy: "KYC provider",
  },
  {
    kind: "right_to_work",
    label: "Right to work",
    blurb: "Citizenship, or a VEVO check against your visa.",
    sensitivity: "public",
    required: true,
    verifiedBy: "Home Affairs (VEVO)",
  },
  {
    kind: "tfn_declaration",
    label: "Tax declaration",
    blurb: "Your TFN declaration, lodged with each employer through STP.",
    sensitivity: "restricted",
    required: true,
    verifiedBy: "You",
  },
  {
    kind: "super_choice",
    label: "Super fund",
    blurb: "Your fund and member number, or your stapled fund.",
    sensitivity: "restricted",
    required: true,
    verifiedBy: "You",
  },
  {
    kind: "bank_account",
    label: "Bank account",
    blurb: "Where wages are paid.",
    sensitivity: "restricted",
    required: true,
    verifiedBy: "You",
  },
  {
    kind: "emergency_contact",
    label: "Emergency contact",
    blurb: "Who a venue calls if something happens on shift.",
    sensitivity: "restricted",
    required: true,
    verifiedBy: "You",
  },
  {
    kind: "casual_agreement",
    label: "Casual agreement",
    blurb: "The standard casual terms, signed once.",
    sensitivity: "public",
    required: true,
    verifiedBy: "You",
  },
  {
    kind: "fwis_ack",
    label: "Fair Work Information Statement",
    blurb: "Delivered and acknowledged — every employer owes you this.",
    sensitivity: "public",
    required: true,
    verifiedBy: "Fair Work Ombudsman",
  },
  {
    kind: "ceis_ack",
    label: "Casual Employment Information Statement",
    blurb: "Delivered and acknowledged — every casual employer owes you this.",
    sensitivity: "public",
    required: true,
    verifiedBy: "Fair Work Ombudsman",
  },
  {
    kind: "credential",
    label: "Tickets and licences",
    blurb: "RSA, RSG, food safety — verified in your Idara wallet.",
    sensitivity: "public",
    required: false,
    verifiedBy: "Issuing authority",
  },
] as const;

export const PACK_ITEM_META: Record<PackItemKind, PackItemMeta> = Object.fromEntries(
  PACK_ITEMS.map((m) => [m.kind, m]),
) as Record<PackItemKind, PackItemMeta>;

export const PACK_ITEM_ORDER: readonly PackItemKind[] = PACK_ITEMS.map((m) => m.kind);

/** The kinds that may never be shown to an employer, only released to a payroll. */
export const RESTRICTED_KINDS: readonly PackItemKind[] = PACK_ITEMS.filter(
  (m) => m.sensitivity === "restricted",
).map((m) => m.kind);

/** The kinds a pack must hold before it can accept an engagement. */
export const REQUIRED_KINDS: readonly PackItemKind[] = PACK_ITEMS.filter((m) => m.required).map(
  (m) => m.kind,
);

export interface PackItem {
  kind: PackItemKind;
  /** Idara, a KYC provider, an RTO, or the worker (self-attested). */
  issuer: DID | string;
  verifiedAt: ISODate;
  expiresAt?: ISODate;
  /** stamped from PACK_ITEM_META by packItem(); never authored. */
  sensitivity: PackItemSensitivity;
  /** sha-256 of the canonical payload — what an auditor compares against. */
  hash: string;
  /**
   * Pointer into the encrypted store. Absent for a `public` item, whose
   * payload is small, non-sensitive and inline.
   */
  payloadRef?: string;
  status: PackItemStatus;
  /**
   * The `public` payload itself, where there is one — a VEVO check result, an
   * acknowledgement date. Never set for a restricted kind; packItem() refuses.
   */
  payload?: Record<string, unknown>;
}

export interface WorkerPack {
  did: DID;
  items: PackItem[];
  /**
   * Where the tax-free threshold is claimed.
   *
   * One employer, chosen by the worker. Undefined means they have not chosen,
   * which is a real state and not a default to "the first one" — claiming the
   * threshold twice is how a multi-employer casual ends the year owing money,
   * and guessing on their behalf would be us causing it.
   */
  primaryEmployerDid?: DID;
  agreementTemplateVersion: string;
}

/* ---------- hashing ---------- */

/**
 * The digest an engagement snapshots and an auditor recomputes.
 *
 * Over the kind AND the payload, so two items with identical contents but
 * different kinds cannot collide — a bank account and an emergency contact
 * that happened to share a shape would otherwise hash the same, and "the pack
 * item that was true at signing" would be ambiguous about which item.
 */
export function hashPackPayload(kind: PackItemKind, payload: unknown): string {
  return sha256Hex(canonicalJson({ kind, payload }));
}

export interface NewPackItem {
  kind: PackItemKind;
  issuer: DID | string;
  verifiedAt: ISODate;
  expiresAt?: ISODate;
  /** hashed here; kept inline for a public kind, stored in the vault otherwise. */
  payload: Record<string, unknown>;
  /** where the vault put the payload. Required for a restricted kind. */
  payloadRef?: string;
  status?: PackItemStatus;
}

/**
 * Build an item, with sensitivity stamped rather than accepted.
 *
 * The throw is the whole point of the function. A restricted item with no
 * vault pointer is one of two things: a payload nobody encrypted, or a
 * payload that cannot be released — and the second fails at provisioning,
 * which is the one moment it must not.
 */
export function packItem(input: NewPackItem): PackItem {
  const meta = PACK_ITEM_META[input.kind];
  if (!meta) throw new Error(`Unknown pack item kind: ${String(input.kind)}`);

  const restricted = meta.sensitivity === "restricted";
  if (restricted && !input.payloadRef) {
    throw new Error(
      `${meta.label} is restricted and must be stored in the vault — pass the payloadRef the vault returned.`,
    );
  }

  return {
    kind: input.kind,
    issuer: input.issuer,
    verifiedAt: input.verifiedAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    sensitivity: meta.sensitivity,
    hash: hashPackPayload(input.kind, input.payload),
    ...(input.payloadRef ? { payloadRef: input.payloadRef } : {}),
    status: input.status ?? "valid",
    // a restricted payload lives in the vault; keeping a second copy here
    // would make the encryption decorative
    ...(restricted ? {} : { payload: input.payload }),
  };
}

/* ---------- reading a pack ---------- */

/**
 * Effective state of one item today.
 *
 * Expiry is evaluated rather than stored, for the same reason completeness is:
 * a right-to-work check that lapsed last night is not "valid" because nobody
 * has run a job to say otherwise.
 */
export function stateOf(item: PackItem, at: ISODate): PackItemStatus {
  if (item.status === "revoked") return "revoked";
  if (item.expiresAt && isBeforeDay(item.expiresAt, calendarDate(at))) return "expired";
  return item.status;
}

/** The item of a kind that counts today, or undefined. Newest verification wins. */
export function itemOf(pack: WorkerPack, kind: PackItemKind): PackItem | undefined {
  return pack.items
    .filter((i) => i.kind === kind)
    .sort((a, b) => (a.verifiedAt < b.verifiedAt ? 1 : -1))[0];
}

export function isValid(pack: WorkerPack, kind: PackItemKind, at: ISODate): boolean {
  const item = itemOf(pack, kind);
  return Boolean(item && stateOf(item, at) === "valid");
}

export interface PackCompleteness {
  ok: boolean;
  /** required kinds with nothing valid behind them, in the order the screen asks for them. */
  missing: PackItemKind[];
  /** required kinds held and valid. */
  held: PackItemKind[];
  /** valid today, but not for much longer. The nudge before the refusal. */
  expiringSoon: { kind: PackItemKind; expiresAt: ISODate; daysLeft: number }[];
  /** 0–1, for the progress ring. Held over required, never over all kinds. */
  progress: number;
}

/** How close an expiry has to be before the pack screen mentions it. */
export const PACK_EXPIRY_WARN_DAYS = 30;

/**
 * What this pack is short of, today.
 *
 * An expired or revoked item counts as missing rather than as present-and-bad.
 * The marketplace asks one question of this — may this person accept an
 * engagement — and for that question a lapsed VEVO check and no VEVO check
 * are the same answer. The pack screen shows the difference, because somebody
 * renewing something needs to know which it is; the gate does not.
 */
export function completenessOf(pack: WorkerPack, at: ISODate): PackCompleteness {
  const missing: PackItemKind[] = [];
  const held: PackItemKind[] = [];
  const expiringSoon: PackCompleteness["expiringSoon"] = [];

  for (const kind of REQUIRED_KINDS) {
    const item = itemOf(pack, kind);
    if (!item || stateOf(item, at) !== "valid") {
      missing.push(kind);
      continue;
    }
    held.push(kind);
    if (item.expiresAt) {
      const daysLeft = daysBetween(calendarDate(at), item.expiresAt);
      if (daysLeft <= PACK_EXPIRY_WARN_DAYS) {
        expiringSoon.push({ kind, expiresAt: item.expiresAt, daysLeft });
      }
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    held,
    expiringSoon,
    progress: REQUIRED_KINDS.length === 0 ? 1 : held.length / REQUIRED_KINDS.length,
  };
}

/* ---------- the tax-free threshold ---------- */

/**
 * May the threshold be claimed with this employer?
 *
 * The rule the ATO states and multi-employer casuals get wrong constantly:
 * claim it with ONE employer, the one you expect to earn the most from.
 * Claiming it twice under-withholds all year and arrives as a bill.
 *
 * So this is a comparison against a choice the worker made, never a default.
 * No primary employer means no claim: withholding a little too much is
 * refundable at tax time, and withholding too little is not.
 */
export function claimsThresholdWith(pack: WorkerPack, employerDid: DID): boolean {
  return pack.primaryEmployerDid === employerDid;
}

/**
 * The line shown when somebody is about to work for a second employer.
 *
 * Returns null when there is nothing to say. It is a warning and not a
 * refusal: which employer pays them most is their knowledge, not ours, and a
 * casual moving venues mid-year has a legitimate reason to move the claim.
 */
export function thresholdNotice(
  pack: WorkerPack,
  employerDid: DID,
  employerName: string,
): string | null {
  if (!pack.primaryEmployerDid) {
    return `You haven't chosen where to claim the tax-free threshold. Until you do, ${employerName} withholds at the no-threshold rate.`;
  }
  if (pack.primaryEmployerDid === employerDid) return null;
  return `You claim the tax-free threshold with another employer, so ${employerName} withholds at the no-threshold rate. Claiming it twice leaves a bill at tax time.`;
}

/* ---------- agreement versions ---------- */

/**
 * Do the two sides hold compatible casual agreements?
 *
 * Exact match, and the strictness is deliberate. A "newer compatible version"
 * is a judgement about legal text, and the only place that judgement can be
 * made correctly is when the new template is written — at which point the
 * compatible predecessors are known and belong in a table beside it. Guessing
 * from a version string ("v2 is probably fine with v1") would have code
 * deciding that two different sets of employment terms are the same terms.
 *
 * Until that table exists, a worker on an older template is asked to re-sign,
 * which is a prompt on a phone rather than an argument in a tribunal.
 */
export function agreementCompatible(worker: string, employer: string): boolean {
  return worker === employer;
}

/* ---------- releases ---------- */

/**
 * The pack items an employer's payroll needs on a first engagement.
 *
 * Ordered as provision() calls them, and used by the accept sheet to tell the
 * worker exactly what is about to leave their pack and where it is going. A
 * release list computed in one place and displayed from another is how a
 * consent screen comes to describe something other than what happens.
 */
export const FIRST_ENGAGEMENT_RELEASES: readonly PackItemKind[] = [
  "identity",
  "bank_account",
  "super_choice",
  "emergency_contact",
  "tfn_declaration",
];

/**
 * A snapshot of what was true at signing: kind → hash, for every valid item.
 *
 * The engagement carries this so an auditor can ask "was the right-to-work
 * check current when this shift was signed?" and get an answer that does not
 * depend on the pack still saying so today. A pack is mutable; a signature is
 * about a moment.
 */
export function packSnapshot(pack: WorkerPack, at: ISODate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kind of PACK_ITEM_ORDER) {
    const item = itemOf(pack, kind);
    if (item && stateOf(item, at) === "valid") out[kind] = item.hash;
  }
  return out;
}
