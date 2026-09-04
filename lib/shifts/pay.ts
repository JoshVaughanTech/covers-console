/* ============================================================
   What a posting pays, and whether it is allowed to say it.

   lib/awards/rates.ts knows the award. This knows how a posting
   asks it a question, and it exists to make one promise real:

     COVERS WILL NOT PUBLISH A SHIFT BELOW THE AWARD FLOOR.

   That promise is the product. It is also the reason the check
   cannot live in the posting form — a form is a convenience, and a
   compliance claim enforced only where someone happens to be
   typing is a claim about the UI, not about the shift. So the
   reason is computed here, from the posting alone, and the publish
   path calls it. The form calls the same function to say it early.

   Two things are deliberately separate:

   `payBlockReason()` answers "may this be published?" and is a
   gate. `describePay()` answers "what will I earn?" and is
   display. A posting that fails the gate still describes itself —
   the manager needs to see the shortfall to fix it.

   Why the pay block is optional: a posting is a real thing before
   anyone has set a rate on it, and the honest rendering of that is
   "rate not published yet", not a fabricated number. Nothing here
   invents a rate for a posting that has none.
   ============================================================ */

import {
  assessOffer,
  fmtAud,
  BAND_LABEL,
  RateTableRangeError,
  type Band,
  type OfferAssessment,
} from "@/lib/awards/rates";
import type { ShiftPay, ShiftPosting } from "./types";

/** How a shift's pay reads on a card, once the award has had its say. */
export interface PaySummary {
  /** what the venue offers, per hour. */
  offeredHourlyCents: number;
  /** the dearest hour's floor — what the offer had to clear. */
  floorHourlyCents: number;
  /** offered − floor, per hour. Negative means the posting underpays. */
  marginHourlyCents: number;
  /** the whole shift at the offered rate, for the paid hours. */
  estGrossCents: number;
  paidHours: number;
  /** unpaid meal break, in hours. The band rows below span it. */
  unpaidHours: number;
  atOrAboveFloor: boolean;
  /**
   * One line per rate period, e.g. Saturday hours after midnight.
   *
   * These cover the shift's whole span, so they sum to more than `paidHours`
   * when there is an unpaid break. That is deliberate — where the break falls
   * is not recorded, so putting it in a band here would be a guess presented
   * as a fact. The screen shows the break separately instead.
   */
  bands: { band: Band; label: string; hours: number; hourlyCents: number }[];
  /** true when the shift crosses into a dearer band — worth showing. */
  mixedRates: boolean;
  awardId: string;
  publicHolidaysChecked: boolean;
  /** safe to render as written. */
  summary: string;
  notModelled: readonly string[];
}

/**
 * Price a posting, or say why it cannot be priced.
 *
 * Returns null when the posting carries no pay block at all — an ordinary
 * state, not an error. Throws nothing: a rate table that does not cover the
 * shift's date comes back as an `unpriceable` reason, because a board that
 * 500s over one stale posting is worse than a board with one card that says
 * its rate could not be checked.
 */
export function priceOf(posting: ShiftPosting): OfferAssessment | null {
  return posting.pay ? priceOfPay(posting.pay) : null;
}

/**
 * The same question asked of a rate that is not on a posting yet.
 *
 * The posting form needs this: it has to show what the gate will decide while
 * the manager is still typing, and inventing a throwaway posting to ask would
 * mean the preview and the gate ran on differently-shaped inputs.
 */
export function priceOfPay(pay: ShiftPay): OfferAssessment {
  return assessOffer(pay.offeredHourlyCents, {
    level: pay.level,
    employment: pay.employment,
    start: pay.startsAt,
    end: pay.endsAt,
    unpaidBreakSec: pay.unpaidBreakSec,
    publicHolidays: pay.publicHolidays,
  });
}

/**
 * The reason this posting may not go on the board, or null if it may.
 *
 * Called by the publish path, not only by the form. See the header.
 */
export function payBlockReason(posting: ShiftPosting): string | null {
  return posting.pay ? payBlockReasonFor(posting.pay) : null; // no rate set is not a bad rate
}

/** The gate, asked of a rate the form is still editing. */
export function payBlockReasonFor(pay: ShiftPay): string | null {
  let a: OfferAssessment;
  try {
    a = priceOfPay(pay);
  } catch (e) {
    /* No rates on file for these dates. Refusing to publish is the safe
       direction: the alternative is putting a shift in front of workers with a
       compliance claim attached that nothing checked. */
    if (e instanceof RateTableRangeError) return e.message;
    throw e;
  }
  if (a.atOrAboveFloor) return null;

  const worst = a.shortSegments[0];
  return (
    `${fmtAud(a.offeredHourlyCents)}/h is below the ${a.price.awardId} floor for this shift. ` +
    `${BAND_LABEL[worst.band]}${worst.adder ? ` ${worst.adder}` : ""} hours must be paid ` +
    `${fmtAud(worst.effectiveHourlyCents)}/h — raise the rate to at least ` +
    `${fmtAud(a.requiredHourlyCents)}/h to publish this shift.`
  );
}

/** The card-facing version. Null when the posting has no rate, or none can be checked. */
export function describePay(posting: ShiftPosting): PaySummary | null {
  return posting.pay ? describePayFor(posting.pay) : null;
}

/** The same, for a rate the posting form is still editing. */
export function describePayFor(pay: ShiftPay): PaySummary | null {
  let a: OfferAssessment;
  try {
    a = priceOfPay(pay);
  } catch (e) {
    if (e instanceof RateTableRangeError) return null;
    throw e;
  }

  /* Segments are per run of identical hours; a card wants one row per BAND, so
     the 17:00–19:00 and 19:00–24:00 weekday runs fold together while the
     Saturday hours after midnight stay their own line. Folding on the rate
     rather than the band would split "weekday" in two and make an ordinary
     Friday night look like an exception. */
  const byBand = new Map<Band, { hours: number; hourlyCents: number }>();
  for (const s of a.price.segments) {
    const row = byBand.get(s.band) ?? { hours: 0, hourlyCents: s.effectiveHourlyCents };
    row.hours += s.seconds / 3600;
    // the dearest hour in the band is the one worth showing
    row.hourlyCents = Math.max(row.hourlyCents, s.effectiveHourlyCents);
    byBand.set(s.band, row);
  }

  const bands = [...byBand.entries()].map(([band, r]) => ({
    band,
    label: BAND_LABEL[band],
    hours: +r.hours.toFixed(2),
    hourlyCents: r.hourlyCents,
  }));

  return {
    offeredHourlyCents: a.offeredHourlyCents,
    floorHourlyCents: a.requiredHourlyCents,
    marginHourlyCents: a.marginHourlyCents,
    estGrossCents: a.offeredGrossCents,
    paidHours: +(a.price.paidSeconds / 3600).toFixed(2),
    unpaidHours: +(a.price.unpaidSeconds / 3600).toFixed(2),
    atOrAboveFloor: a.atOrAboveFloor,
    bands,
    mixedRates: bands.length > 1,
    awardId: a.price.awardId,
    publicHolidaysChecked: a.price.publicHolidaysChecked,
    summary: a.summary,
    notModelled: a.price.notModelled,
  };
}
