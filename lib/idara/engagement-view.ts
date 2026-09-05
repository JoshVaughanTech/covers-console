/* ============================================================
   An engagement, rendered for a person.

   One shape, computed once, sent to both the phone and the console.
   The alternative — each screen assembling its own view over the
   same engagement — is how the accept sheet comes to describe a
   different set of releases from the one the console shows an
   auditor, and neither of them notices.

   Everything a worker is told before they sign is here: what it
   pays, what it clears the award by, what leaves their pack, where
   it goes, and what happens to their tax-free threshold. Nothing on
   this shape is a payload — kinds, labels, hashes and connector ids
   only. A view model that could carry a TFN is a view model that
   eventually will.
   ============================================================ */

import { engagementCost, plannedReleases, type Engagement, type EngagementStatus } from "./engagement";
import { PACK_ITEM_META, type PackItemKind } from "./pack";
import { employerOf } from "./employer-seed";
import { SITES } from "./seed";
import type { PayrollConnectorId } from "@/lib/payroll/types";

const siteIndex = new Map(SITES.map((s) => [s.id, s]));

export interface ReleaseView {
  item: PackItemKind;
  label: string;
  toConnector: PayrollConnectorId;
  at: string;
}

export interface EngagementView {
  id: string;
  status: EngagementStatus;
  role: string;
  siteId: string;
  siteName: string;
  date: string;
  window: string;
  employer: { did: string; name: string; abn: string; signatory: string };
  /** set only on the partner-EOR path, where the venue is not the employer. */
  host: { did: string; name: string } | null;
  pay: {
    offeredHourlyCents: number;
    floorHourlyCents: number;
    marginHourlyCents: number;
    level: string | number;
    stream: string;
    loadings: string[];
    superRate: number;
    hours: number;
    estGrossCents: number;
    estSuperCents: number;
  };
  employment: {
    first: boolean;
    claimsTaxFreeThreshold: boolean;
    agreementTemplateVersion: string;
  };
  /** what WILL be released if they sign. Empty on a repeat engagement. */
  willRelease: { item: PackItemKind; label: string }[];
  /** what already has been, and to which payroll. */
  releases: ReleaseView[];
  acceptance: {
    worker: { at: string; eventHash: string } | null;
    employer: { at: string; eventHash: string; byDid?: string } | null;
  };
  /** kind → hash, exactly as signed. What an auditor recomputes. */
  packSnapshot: Record<string, string>;
  employerProfileHash: string;
  proposedAt: string;
  cancelledReason: string | null;
}

export function describeEngagement(e: Engagement): EngagementView {
  const employer = employerOf(e.employerDid);
  const host = e.hostDid ? employerOf(e.hostDid) : undefined;
  const cost = engagementCost(e);

  return {
    id: e.id,
    status: e.status,
    role: e.shift.role,
    siteId: e.shift.siteId,
    siteName: siteIndex.get(e.shift.siteId)?.name ?? e.shift.siteId,
    date: e.shift.date,
    window: `${e.shift.start}–${e.shift.end}`,
    employer: {
      did: e.employerDid,
      name: employer?.tradingName ?? e.employerDid,
      abn: employer?.abn ?? "",
      signatory: employer?.signatoryName ?? "",
    },
    host: host ? { did: host.did, name: host.tradingName } : null,
    pay: {
      offeredHourlyCents: e.pay.offeredRateCents,
      floorHourlyCents: e.pay.baseRateCents,
      marginHourlyCents: e.pay.offeredRateCents - e.pay.baseRateCents,
      level: e.pay.classification.level,
      stream: e.pay.classification.stream,
      loadings: e.pay.loadings,
      superRate: e.pay.superRate,
      hours: cost.hours,
      estGrossCents: cost.wagesCents,
      estSuperCents: cost.superCents,
    },
    employment: {
      first: e.employment.firstEngagementWithEmployer,
      claimsTaxFreeThreshold: e.employment.claimsTaxFreeThreshold,
      agreementTemplateVersion: e.employment.agreementTemplateVersion,
    },
    /* Computed from the engagement, not written beside it, so the sheet a
       worker reads before signing and the code that does the releasing cannot
       describe different things. */
    willRelease: plannedReleases(e).map((item) => ({
      item,
      label: PACK_ITEM_META[item].label,
    })),
    releases: e.releases.map((r) => ({
      item: r.item,
      label: PACK_ITEM_META[r.item]?.label ?? r.item,
      toConnector: r.toConnector,
      at: r.at,
    })),
    acceptance: {
      worker: e.acceptance.worker,
      employer: e.acceptance.employer,
    },
    packSnapshot: e.packSnapshot,
    employerProfileHash: e.employerProfileHash,
    proposedAt: e.proposedAt,
    cancelledReason: e.cancelledReason ?? null,
  };
}

/** What the worker is waiting on, in one word, for a list row. */
export function standingOfEngagement(e: Engagement): "sign" | "signed" | "ready" | "done" | "cancelled" {
  if (e.status === "cancelled") return "cancelled";
  if (e.status === "confirmed" || e.status === "worked") return "done";
  if (e.status === "provisioned") return "ready";
  return e.acceptance.worker ? "signed" : "sign";
}
