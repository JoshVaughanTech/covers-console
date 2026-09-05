/* ============================================================
   POST /api/engagements/accept — the tap that is the signature.

   This is the whole product in one request. A worker taps once; a
   verified identity signs an agreement whose terms are pinned by
   hash to their pack and the venue's profile; the acceptance is
   chained; and if the venue's half is already in, their details go
   into that venue's payroll with every field pre-filled. The venue
   types nothing, and nobody handles a form.

   Three things are re-derived rather than trusted, and each of them
   would be a hole if it were not:

   • WHO IS SIGNING comes from the session. A did in the body would
     let one phone sign somebody else onto an employment agreement.
   • THE ENGAGEMENT comes from the chain, not the request. The
     phone sends an id; the terms are read from the event that
     proposed them, so a tampered body cannot alter the rate on the
     agreement it is accepting.
   • THE PACK IS CHECKED AGAIN. A right-to-work check that lapsed
     between the offer and the tap must stop the signature, and the
     screen cannot be the thing that notices.

   Provisioning runs inside this request, after the signature. If it
   fails, the acceptance stands — the worker did accept, and the
   chain should say so — and the engagement stays at `accepted`
   until a retry gets the payroll to take it. Reporting the shift as
   provisioned when no employee exists would be the one lie this
   system cannot afford.
   ============================================================ */
import { NextResponse } from "next/server";
import { workerOf } from "@/lib/auth/session";
import { eventStore } from "@/lib/store/events";
import {
  acceptRefusal,
  acceptedEvent,
  isFullySigned,
  provisionedEvent,
  replayEngagements,
} from "@/lib/idara/engagement";
import { describeEngagement } from "@/lib/idara/engagement-view";
import { completenessOf } from "@/lib/idara/pack";
import { packOf } from "@/lib/idara/pack-seed";
import { packVault } from "@/lib/idara/vault";
import { employerOf } from "@/lib/idara/employer-seed";
import { TODAY } from "@/lib/idara/seed";
import { boardFrom } from "@/lib/shifts";
import { mockPayroll, mockTimeClock } from "@/lib/payroll/mock";
import { provisionEngagement } from "@/lib/payroll/provision";
import type { PayrollConnector } from "@/lib/payroll/types";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

/**
 * The connector for an employer's payroll.
 *
 * Only the demo connector is built. A profile naming a payroll nobody has
 * written yet is refused by name rather than quietly falling back to the mock
 * — "provisioned to Xero" when nothing reached Xero is exactly the sentence
 * this endpoint must never be able to produce. One connector per pilot; the
 * others are a line in this switch when they exist.
 */
function connectorFor(id: string): PayrollConnector | null {
  return id === "mock" ? mockPayroll() : null;
}

interface AcceptBody {
  engagementId?: unknown;
  /** the phone's own id for this tap, so a retry is not a second signature. */
  clientRef?: unknown;
}

export async function POST(req: Request) {
  const caller = workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as AcceptBody | null;
  const engagementId = typeof body?.engagementId === "string" ? body.engagementId : null;
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  }

  const store = eventStore();

  /* A retry is answered before anything is decided — the same shape the claim
     endpoint uses. Without this the second attempt finds the engagement
     already signed and reports a conflict for a signature that succeeded. */
  const ref =
    typeof body?.clientRef === "string" && body.clientRef
      ? `engagement:accept:${caller.did}:${body.clientRef}`
      : null;
  if (ref) {
    const already = store.byClientRef(ORG, ref);
    if (already) {
      const e = replayEngagements(store.all(ORG)).find((x) => x.id === engagementId);
      return NextResponse.json({
        accepted: true,
        created: false,
        engagement: e ? describeEngagement(e) : null,
      });
    }
  }

  const engagement = replayEngagements(store.all(ORG)).find((e) => e.id === engagementId);
  if (!engagement) return NextResponse.json({ error: "unknown engagement" }, { status: 404 });

  /* Not 403. Whether an engagement exists is itself information about
     somebody else's employment, so a request for one that is not yours is
     answered exactly as a request for one that does not exist. */
  if (engagement.workerDid !== caller.did) {
    return NextResponse.json({ error: "unknown engagement" }, { status: 404 });
  }

  const refusal = acceptRefusal(engagement, "worker");
  if (refusal) return NextResponse.json({ error: refusal, kind: "state" }, { status: 409 });

  const pack = packOf(caller.did);
  if (!pack) return NextResponse.json({ error: "no pack" }, { status: 409 });

  const completeness = completenessOf(pack, TODAY);
  if (!completeness.ok) {
    return NextResponse.json(
      {
        error: `Your pack is missing ${completeness.missing.length} item${completeness.missing.length === 1 ? "" : "s"} — you can't be employed until it's complete.`,
        kind: "pack",
        missing: completeness.missing,
      },
      { status: 409 },
    );
  }

  const at = new Date().toISOString();
  store.append(
    ORG,
    acceptedEvent(engagement, "worker", {
      at,
      actor: caller.person.name,
      actorDid: caller.person.did,
      byDid: caller.person.did,
    }),
    ref ? { clientRef: ref } : {},
  );

  /* Re-read rather than mutate. The acceptance's evidence is the event's own
     hash, which only exists once the store has chained it — so the engagement
     that carries a real signature is the one the fold returns, not the one
     this handler was holding. */
  const signed = replayEngagements(store.all(ORG)).find((e) => e.id === engagementId);
  if (!signed) return NextResponse.json({ error: "engagement vanished" }, { status: 500 });

  if (!isFullySigned(signed)) {
    return NextResponse.json({ accepted: true, created: true, engagement: describeEngagement(signed) });
  }

  const employer = employerOf(signed.employerDid);
  const connectorId = employer?.payroll?.connector;
  const connector = connectorId ? connectorFor(connectorId) : null;
  if (!employer || !connector) {
    return NextResponse.json(
      {
        accepted: true,
        created: true,
        engagement: describeEngagement(signed),
        provisioned: false,
        error: connectorId
          ? `No connector built for ${connectorId} yet, so nothing was sent to payroll.`
          : "This venue has no payroll connected, so nothing was sent to payroll.",
      },
      { status: 202 },
    );
  }

  const posting = boardFrom(store.all(ORG)).postings.find((p) => p.id === signed.postingId);

  try {
    const result = await provisionEngagement({
      engagement: signed,
      pack,
      connector,
      vault: packVault(),
      ...(employer.timeClock ? { timeClock: mockTimeClock() } : {}),
      // the employment type is the posting's, because it is the shift that
      // says whether this is casual work — not the person's usual status
      employmentType: posting?.pay?.employment ?? "casual",
      at,
    });

    store.append(
      ORG,
      provisionedEvent(signed, {
        at,
        actor: employer.tradingName,
        connector: connector.id,
        released: result.released,
        ...(result.externalId ? { externalId: result.externalId } : {}),
      }),
      { clientRef: `engagement:provisioned:${signed.id}` },
    );

    const provisioned = replayEngagements(store.all(ORG)).find((e) => e.id === engagementId);

    return NextResponse.json(
      {
        accepted: true,
        created: true,
        provisioned: true,
        createdEmployee: result.createdEmployee,
        released: result.released,
        engagement: describeEngagement(provisioned ?? signed),
      },
      { status: 201 },
    );
  } catch (e) {
    /* 502, and the acceptance stays on the chain. The signature happened; the
       payroll did not answer. A retry re-runs provisioning against an
       engagement that is already signed, which is the path provisionEngagement
       is built to be safe on. */
    return NextResponse.json(
      {
        accepted: true,
        created: true,
        provisioned: false,
        error: e instanceof Error ? e.message : "Payroll did not accept the employee.",
        engagement: describeEngagement(signed),
      },
      { status: 502 },
    );
  }
}
