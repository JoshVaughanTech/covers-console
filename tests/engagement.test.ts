/* ============================================================
   The engagement.

   What is being tested is that an engagement cannot come into
   existence on terms nobody could defend. Every refusal below is a
   thing that, uncaught, ends as either an underpayment, a person
   employed on an incomplete record, or a tax bill somebody did not
   know they were accumulating.

   The rate check gets the most attention because it is the one that
   looks fine when it is wrong: an offer that clears the average and
   misses the midnight hour is a shift that reads as generous on
   every screen and underpays on the payslip.

   The replay tests are the other half. An engagement is only
   evidence if it can be rebuilt from the chain by somebody who does
   not trust our database, so the state machine is exercised through
   real appended events rather than by calling the transitions
   directly.
   ============================================================ */
import { describe, it, expect } from "vitest";
import {
  BOOKING_FEE_RATE,
  SUPER_GUARANTEE_RATE,
  acceptEngagement,
  acceptRefusal,
  acceptedEvent,
  engagementCost,
  engagementId,
  hasWorkedFor,
  isFullySigned,
  plannedReleases,
  proposeEngagement,
  proposedEvent,
  provisionedEvent,
  replayEngagements,
  type Engagement,
  type ProposeInput,
} from "../lib/idara/engagement";
import { appendEvent } from "../lib/idara/audit";
import type { AuditEvent } from "../lib/idara/types";
import { buildPacks, OTHER_EMPLOYER_DID } from "../lib/idara/pack-seed";
import { PackVault } from "../lib/idara/vault";
import { EMPLOYERS } from "../lib/idara/employer-seed";
import type { EmployerProfile } from "../lib/idara/employer";
import { WORKERS } from "../lib/idara/seed";

const AT = "2024-05-16";
const vault = new PackVault();
const packs = buildPacks(vault);
const worker = (name: string) => WORKERS.find((w) => w.name === name)!;
const packOf = (name: string) => packs.get(worker(name).did)!;
const EMPLOYER = EMPLOYERS[0];

/** A Friday bar shift, priced the way lib/awards prices it. */
const SHIFT = {
  siteId: "s-brightwater",
  date: "2026-09-11",
  start: "17:00",
  end: "01:00",
  role: "Bartender",
  startsAt: 1_757_581_200,
  endsAt: 1_757_610_000,
};

function input(over: Partial<ProposeInput> = {}): ProposeInput {
  const name = "Darie Roberts";
  return {
    worker: { did: worker(name).did, name },
    pack: packOf(name),
    employer: EMPLOYER,
    postingId: "p-1",
    shift: SHIFT,
    offeredRateCents: 4150,
    floorRateCents: 4062,
    loadings: ["casual_25", "saturday"],
    blockReason: null,
    priorEngagements: [],
    at: AT,
    ...over,
  };
}

function proposed(over: Partial<ProposeInput> = {}): Engagement {
  const r = proposeEngagement(input(over));
  if (!r.ok) throw new Error(`expected a proposal, got: ${r.refusals.map((x) => x.code).join(", ")}`);
  return r.engagement;
}

const codes = (over: Partial<ProposeInput>) => {
  const r = proposeEngagement(input(over));
  return r.ok ? [] : r.refusals.map((x) => x.code);
};

describe("proposing", () => {
  it("assembles the deal when both sides are ready", () => {
    const e = proposed();
    expect(e.status).toBe("proposed");
    expect(e.workerDid).toBe(worker("Darie Roberts").did);
    expect(e.employerDid).toBe(EMPLOYER.did);
    expect(e.pay.classification).toEqual({ level: 2, stream: "food_and_beverage" });
    expect(e.pay.superRate).toBe(SUPER_GUARANTEE_RATE);
    expect(e.acceptance).toEqual({ worker: null, employer: null });
    expect(e.releases).toEqual([]);
  });

  it("pins both sides by hash", () => {
    const e = proposed();
    // the pack as it stood, and the profile as it stood: an auditor recomputes
    // these rather than taking our word for what was true at signing
    expect(e.packSnapshot.identity).toBeTruthy();
    expect(e.packSnapshot.tfn_declaration).toBeTruthy();
    expect(e.employerProfileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  /* The floor passed in is the DEAREST hour, not the blended average. A test
     that used the average would pass while the module underpaid the midnight
     hour, which is the exact failure assessOffer() exists to prevent. */
  it("refuses an offer below the floor", () => {
    expect(codes({ offeredRateCents: 4000, floorRateCents: 4062 })).toContain("rate.below_floor");
  });

  it("allows an offer exactly at the floor", () => {
    expect(codes({ offeredRateCents: 4062, floorRateCents: 4062 })).toEqual([]);
  });

  it("refuses an incomplete pack, and names what is short", () => {
    const r = proposeEngagement(
      input({ worker: { did: worker("Liam O'Brien").did, name: "Liam O'Brien" }, pack: packOf("Liam O'Brien") }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const refusal = r.refusals.find((x) => x.code === "pack.incomplete")!;
    expect(refusal.missing).toEqual(["tfn_declaration", "super_choice"]);
  });

  it("refuses when the two agreement templates differ", () => {
    const employer: EmployerProfile = { ...EMPLOYER, agreementTemplateVersion: "casual-higa-v2" };
    expect(codes({ employer })).toContain("agreement.version_mismatch");
  });

  it("passes the gate's refusal straight through", () => {
    expect(codes({ blockReason: "RSA expired 2 May" })).toContain("eligibility.blocked");
  });

  /* Which level a job sits at decides what it pays, so an unclassified role is
     a question for the venue rather than a default of Level 1. */
  it("refuses a role the venue has not classified", () => {
    expect(codes({ shift: { ...SHIFT, role: "Sommelier" } })).toContain("classification.missing");
  });

  /* An off-premise wedding rostered a level up from the same job in the
     bistro is normal, and nobody is harmed by being paid more. A shift priced
     a level DOWN is the venue paying under its own recorded position for the
     work, which is the shape an underpayment actually takes. */
  it("allows a shift priced above the venue's classification, and names that level", () => {
    expect(codes({ pricedLevel: 3 })).toEqual([]);
    expect(proposed({ pricedLevel: 3 }).pay.classification).toEqual({
      level: 3,
      stream: "food_and_beverage",
    });
  });

  it("refuses a shift priced below the venue's own classification", () => {
    expect(codes({ pricedLevel: 1 })).toContain("classification.below_profile");
    expect(codes({ pricedLevel: "introductory" })).toContain("classification.below_profile");
  });

  it("refuses an employer with no payroll connected", () => {
    const employer: EmployerProfile = { ...EMPLOYER };
    delete employer.payroll;
    expect(codes({ employer })).toContain("employer.not_ready");
  });

  it("refuses an employer whose workers' compensation has lapsed", () => {
    const employer: EmployerProfile = {
      ...EMPLOYER,
      workersComp: { ...EMPLOYER.workersComp, expiresAt: "2024-01-01" },
    };
    expect(codes({ employer })).toContain("employer.not_ready");
  });

  it("refuses a venue on an enterprise agreement rather than pricing it against the award", () => {
    expect(codes({ employer: { ...EMPLOYER, awardMode: "eba" } })).toContain("employer.not_ready");
  });

  it("refuses a venue that has not turned one-tap on", () => {
    expect(codes({ employer: { ...EMPLOYER, acceptsPacks: false } })).toContain("employer.not_ready");
  });

  /* Two people have to act on two different problems. Returning one at a time
     means learning about the second only after fixing the first. */
  it("collects every refusal rather than stopping at the first", () => {
    const found = codes({
      offeredRateCents: 100,
      blockReason: "RSA expired",
      shift: { ...SHIFT, role: "Sommelier" },
    });
    expect(found).toContain("rate.below_floor");
    expect(found).toContain("eligibility.blocked");
    expect(found).toContain("classification.missing");
  });
});

/* §9 of the design: a licensed labour-hire partner is the employer and the
   venue is recorded as the host. It is a config branch rather than a second
   product — and it is deliberately not reachable from lib/shifts/engage.ts,
   because switching it on needs a signed partner agreement rather than a
   deploy. What is tested here is that the branch puts the right party on the
   credential when something does pass it. */
describe("the partner-EOR path", () => {
  const PARTNER = "did:web:idara.app:o:partner-labour-hire";

  it("names the partner as employer and the venue as host", () => {
    const e = proposed({ employerOfRecordDid: PARTNER });
    expect(e.employerDid).toBe(PARTNER);
    expect(e.hostDid).toBe(EMPLOYER.did);
  });

  /* The threshold follows the EMPLOYER, not the venue. Somebody whose primary
     is the venue is not claiming it with the partner that actually pays them,
     and getting this backwards would under-withhold all year. */
  it("decides the threshold against the party that pays", () => {
    expect(proposed({ employerOfRecordDid: PARTNER }).employment.claimsTaxFreeThreshold).toBe(false);
  });

  it("leaves the venue as employer when the path is off", () => {
    expect(proposed().hostDid).toBeUndefined();
  });
});

describe("the tax-free threshold on the engagement", () => {
  it("is claimed only with the employer the worker nominated", () => {
    expect(proposed().employment.claimsTaxFreeThreshold).toBe(true);
  });

  it("is not claimed where the worker's primary is elsewhere", () => {
    const e = proposed({
      worker: { did: worker("Leanne Vidal").did, name: "Leanne Vidal" },
      pack: packOf("Leanne Vidal"),
    });
    expect(packOf("Leanne Vidal").primaryEmployerDid).toBe(OTHER_EMPLOYER_DID);
    expect(e.employment.claimsTaxFreeThreshold).toBe(false);
  });

  it("is not claimed when nobody has been nominated", () => {
    const e = proposed({
      worker: { did: worker("Aaron Patel").did, name: "Aaron Patel" },
      pack: packOf("Aaron Patel"),
    });
    expect(e.employment.claimsTaxFreeThreshold).toBe(false);
  });
});

describe("first engagement, and the id that stops a second one", () => {
  it("is the first when nothing has been signed with this employer", () => {
    expect(proposed().employment.firstEngagementWithEmployer).toBe(true);
  });

  it("is not the first once one has been signed", () => {
    const signed = acceptEngagement(proposed(), "worker", { at: AT, eventHash: "h" });
    const second = proposed({ postingId: "p-2", priorEngagements: [signed] });
    expect(second.employment.firstEngagementWithEmployer).toBe(false);
    expect(plannedReleases(second)).toEqual([]);
  });

  /* A proposal nobody accepted employed nobody. Counting it would suppress the
     payroll creation that the real first engagement depends on, and the worker
     would be rostered with no employee record anywhere. */
  it("does not count a proposal the worker never signed", () => {
    const unsigned = proposed();
    expect(hasWorkedFor([unsigned], unsigned.workerDid, EMPLOYER.did)).toBe(false);
    expect(proposed({ postingId: "p-2", priorEngagements: [unsigned] }).employment.firstEngagementWithEmployer).toBe(true);
  });

  it("does not count a cancelled engagement", () => {
    const cancelled: Engagement = {
      ...acceptEngagement(proposed(), "worker", { at: AT, eventHash: "h" }),
      status: "cancelled",
    };
    expect(hasWorkedFor([cancelled], cancelled.workerDid, EMPLOYER.did)).toBe(false);
  });

  it("derives the id from the posting and the worker, so a retry is the same engagement", () => {
    expect(proposed().id).toBe(engagementId("p-1", worker("Darie Roberts").did));
    expect(proposed({ postingId: "p-2" }).id).not.toBe(proposed().id);
  });
});

describe("signing", () => {
  it("needs both sides before it is agreed", () => {
    const e = proposed();
    const one = acceptEngagement(e, "worker", { at: AT, eventHash: "h1" });
    expect(one.status).toBe("proposed");
    expect(isFullySigned(one)).toBe(false);

    const both = acceptEngagement(one, "employer", { at: AT, eventHash: "h2", byDid: EMPLOYER.signatoryDid });
    expect(both.status).toBe("accepted");
    expect(isFullySigned(both)).toBe(true);
  });

  it("takes the two signatures in either order", () => {
    const e = proposed();
    const employerFirst = acceptEngagement(e, "employer", { at: AT, eventHash: "h2" });
    const both = acceptEngagement(employerFirst, "worker", { at: AT, eventHash: "h1" });
    expect(both.status).toBe("accepted");
  });

  it("ignores a second signature from the same side", () => {
    const one = acceptEngagement(proposed(), "worker", { at: AT, eventHash: "h1" });
    const again = acceptEngagement(one, "worker", { at: AT, eventHash: "h-other" });
    expect(again.acceptance.worker?.eventHash).toBe("h1");
  });

  it("says why a sheet that has been sitting open can no longer be signed", () => {
    const e = proposed();
    expect(acceptRefusal(e, "worker")).toBeNull();
    expect(acceptRefusal({ ...e, status: "cancelled" }, "worker")).toMatch(/cancelled/i);
    const signed = acceptEngagement(e, "worker", { at: AT, eventHash: "h1" });
    expect(acceptRefusal(signed, "worker")).toMatch(/already signed/i);
  });
});

describe("rebuilt from the chain", () => {
  /* The whole state machine, driven only by appended events — which is how the
     server does it. Nothing here calls a transition directly. */
  const chainFor = (e: Engagement): AuditEvent[] => {
    let log: AuditEvent[] = [];
    log = appendEvent(log, proposedEvent(e, "Emma Taylor", "did:web:idara.app:u:emma-taylor"));
    log = appendEvent(
      log,
      acceptedEvent(e, "employer", { at: AT, actor: "Emma Taylor", byDid: EMPLOYER.signatoryDid }),
    );
    log = appendEvent(
      log,
      acceptedEvent(e, "worker", { at: AT, actor: "Darie Roberts", actorDid: e.workerDid }),
    );
    log = appendEvent(
      log,
      provisionedEvent(e, {
        at: AT,
        actor: "Brightwater Hospitality",
        connector: "mock",
        released: ["identity", "bank_account", "super_choice", "emergency_contact", "tfn_declaration"],
      }),
    );
    return log;
  };

  it("ends at provisioned with both signatures in place", () => {
    const [rebuilt] = replayEngagements(chainFor(proposed()));
    expect(rebuilt.status).toBe("provisioned");
    expect(rebuilt.acceptance.worker).not.toBeNull();
    expect(rebuilt.acceptance.employer).not.toBeNull();
  });

  it("records each signature's chain position as its evidence", () => {
    const log = chainFor(proposed());
    const [rebuilt] = replayEngagements(log);
    const employerEvent = log.find((x) => x.type === "engagement.accepted" && x.data.side === "employer")!;
    const workerEvent = log.find((x) => x.type === "engagement.accepted" && x.data.side === "worker")!;
    expect(rebuilt.acceptance.employer?.eventHash).toBe(employerEvent.hash);
    expect(rebuilt.acceptance.worker?.eventHash).toBe(workerEvent.hash);
    // the venue's half is signed by its named signatory, not by whoever clicked
    expect(rebuilt.acceptance.employer?.byDid).toBe(EMPLOYER.signatoryDid);
  });

  it("carries the release log, kinds only", () => {
    const [rebuilt] = replayEngagements(chainFor(proposed()));
    expect(rebuilt.releases.map((r) => r.item)).toEqual([
      "identity",
      "bank_account",
      "super_choice",
      "emergency_contact",
      "tfn_declaration",
    ]);
    expect(rebuilt.releases.every((r) => r.toConnector === "mock")).toBe(true);
    // nothing resembling a payload made it onto the chain
    expect(JSON.stringify(rebuilt.releases)).not.toMatch(/000 000/);
  });

  it("is a function of the log alone — replaying twice gives the same answer", () => {
    const log = chainFor(proposed());
    expect(replayEngagements(log)).toEqual(replayEngagements(log));
  });

  it("does not duplicate an engagement when a proposal is replayed", () => {
    const e = proposed();
    let log: AuditEvent[] = [];
    log = appendEvent(log, proposedEvent(e, "Emma Taylor"));
    log = appendEvent(log, proposedEvent(e, "Emma Taylor"));
    expect(replayEngagements(log)).toHaveLength(1);
  });

  it("skips an unreadable proposal rather than losing the rest", () => {
    let log: AuditEvent[] = [];
    log = appendEvent(log, {
      type: "engagement.proposed",
      at: AT,
      actor: "Emma Taylor",
      summary: "corrupt",
      data: { engagementId: "eng-broken" },
    });
    log = appendEvent(log, proposedEvent(proposed(), "Emma Taylor"));
    expect(replayEngagements(log)).toHaveLength(1);
  });
});

describe("what it costs", () => {
  it("splits wages, super and the booking fee", () => {
    const e = proposed();
    const cost = engagementCost(e, 8);
    expect(cost.wagesCents).toBe(4150 * 8);
    expect(cost.superCents).toBe(Math.round(4150 * 8 * SUPER_GUARANTEE_RATE));
    expect(cost.bookingFeeCents).toBe(Math.round(4150 * 8 * BOOKING_FEE_RATE));
    expect(cost.totalCents).toBe(cost.wagesCents + cost.superCents + cost.bookingFeeCents);
  });
});
