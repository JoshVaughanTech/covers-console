/* ============================================================
   GET  /api/employer — the venue's employer profile and what is
                        standing between it and employing anybody.
   POST /api/employer — connect a payroll, or turn one-tap on/off.

   Operators only. This is the venue's own record: its ABN, its
   payroll connection, the policy that insures the people on its
   floor, and the signature that goes on every engagement. A worker
   session has no business here, and asks for its own pack instead.

   The readiness answer is computed, never stored. profileGaps()
   re-runs on every read, so a workers' compensation policy that
   expired overnight makes the venue unable to employ this morning
   rather than whenever something remembers to re-check.
   ============================================================ */
import { NextResponse } from "next/server";
import { operatorOf } from "@/lib/auth/session";
import { eventStore } from "@/lib/store/events";
import { EMPLOYERS } from "@/lib/idara/employer-seed";
import { employerProfileHash, profileGaps } from "@/lib/idara/employer";
import { replayEngagements } from "@/lib/idara/engagement";
import { replayEmployer } from "@/lib/idara/employer-replay";
import type { NewAuditEvent } from "@/lib/idara/audit";
import { SITES, TODAY } from "@/lib/idara/seed";
import { PAYROLL_CONNECTORS, type PayrollConnectorId } from "@/lib/payroll/types";
import { mockPayroll } from "@/lib/payroll/mock";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const siteIndex = new Map(SITES.map((s) => [s.id, s]));

/** Single employer in the demo; the seam where a multi-org console picks one. */
function profile() {
  return EMPLOYERS[0];
}

export async function GET(req: Request) {
  if (!(await operatorOf(req))) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const log = await (await eventStore()).all(ORG);
  const p = replayEmployer(profile(), log);
  const at = TODAY;
  const gaps = profileGaps(p, at);
  const engagements = replayEngagements(log).filter((e) => e.employerDid === p.did);

  return NextResponse.json({
    at,
    profile: {
      did: p.did,
      abn: p.abn,
      legalName: p.legalName,
      tradingName: p.tradingName,
      sites: p.siteIds.map((id) => ({ id, name: siteIndex.get(id)?.name ?? id })),
      payroll: p.payroll ?? null,
      timeClock: p.timeClock ?? null,
      workersComp: p.workersComp,
      awardMode: p.awardMode,
      classifications: Object.entries(p.classifications).map(([role, c]) => ({
        role,
        level: c.level,
        stream: c.stream,
      })),
      agreementTemplateVersion: p.agreementTemplateVersion,
      signatory: { did: p.signatoryDid, name: p.signatoryName },
      acceptsPacks: p.acceptsPacks,
    },
    /* The hash every engagement pins. Shown so the console can say which
       version of this profile a given agreement was signed against — change
       the payroll connection and new engagements carry a different hash,
       which is the point of pinning it. */
    profileHash: employerProfileHash(p),
    gaps,
    ready: gaps.length === 0,
    connectors: Object.entries(PAYROLL_CONNECTORS).map(([id, meta]) => ({
      id,
      ...meta,
      // one connector per pilot; the rest are listed so the choice is visible
      available: id === "mock",
    })),
    counts: {
      engagements: engagements.length,
      awaitingWorker: engagements.filter((e) => e.status === "proposed").length,
      provisioned: engagements.filter(
        (e) => e.status === "provisioned" || e.status === "worked" || e.status === "confirmed",
      ).length,
      employeesInPayroll: p.payroll?.connector === "mock" ? mockPayroll().employeeCount : null,
    },
  });
}

interface EmployerBody {
  payroll?: { connector?: unknown; tenantRef?: unknown } | null;
  acceptsPacks?: unknown;
}

/**
 * Change the venue's employment settings.
 *
 * Two switches, and both of them are the venue's to throw. Disconnecting a
 * payroll does NOT touch engagements already provisioned: those employees
 * exist in that payroll and the releases already happened, and rewriting the
 * record to say otherwise would be the console lying about a disclosure.
 */
export async function POST(req: Request) {
  const caller = await operatorOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as EmployerBody | null;
  if (!body) return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });

  const store = await eventStore();
  /* Read before deciding, so a change that changes nothing writes nothing. A
     settings screen that POSTs on every render would otherwise fill the chain
     with a venue repeatedly agreeing with itself. */
  const before = replayEmployer(profile(), await store.all(ORG));

  const at = new Date().toISOString();
  const actor = caller.operator.name;
  const actorDid = caller.operator.did;
  const pending: NewAuditEvent[] = [];

  if (body.payroll === null) {
    if (before.payroll) {
      pending.push({
        type: "employer.payroll_disconnected",
        at,
        actor,
        actorDid,
        summary: `${before.tradingName} disconnected ${PAYROLL_CONNECTORS[before.payroll.connector]?.label ?? before.payroll.connector} — it cannot employ anybody until a payroll is connected`,
        data: { connector: before.payroll.connector, tenantRef: before.payroll.tenantRef },
      });
    }
  } else if (body.payroll) {
    const connector = body.payroll.connector;
    const tenantRef = body.payroll.tenantRef;
    /* Both refusals happen BEFORE anything is appended. A chain that records a
       rejected connector as a fact is worse than one that never heard of it. */
    if (typeof connector !== "string" || !(connector in PAYROLL_CONNECTORS)) {
      return NextResponse.json({ error: "unknown payroll connector" }, { status: 400 });
    }
    if (connector !== "mock") {
      return NextResponse.json(
        {
          error: `${PAYROLL_CONNECTORS[connector as PayrollConnectorId].label} is not built yet. One connector per pilot — connecting a name with nothing behind it would show this venue as ready to employ when it is not.`,
        },
        { status: 400 },
      );
    }
    const ref = typeof tenantRef === "string" && tenantRef ? tenantRef : "brightwater-demo";
    if (before.payroll?.connector !== connector || before.payroll?.tenantRef !== ref) {
      pending.push({
        type: "employer.payroll_connected",
        at,
        actor,
        actorDid,
        summary: `${before.tradingName} connected ${PAYROLL_CONNECTORS[connector as PayrollConnectorId].label} payroll`,
        data: { connector, tenantRef: ref, connectedAt: at.slice(0, 10) },
      });
    }
  }

  if (typeof body.acceptsPacks === "boolean" && body.acceptsPacks !== before.acceptsPacks) {
    pending.push({
      type: "employer.packs_set",
      at,
      actor,
      actorDid,
      summary: body.acceptsPacks
        ? `${before.tradingName} turned one-tap employment on`
        : `${before.tradingName} turned one-tap employment off — a completed pack no longer employs anybody here`,
      data: { accepts: body.acceptsPacks },
    });
  }

  /* One at a time and awaited, like the confirm sweep: every append takes the
     chain lock, and issuing them together would only mean a failure halfway
     leaving the rest in flight with nothing saying which had landed. */
  for (const ev of pending) {
    await store.append(ORG, ev);
  }

  const p = replayEmployer(profile(), await store.all(ORG));
  const gaps = profileGaps(p, TODAY);
  return NextResponse.json({
    payroll: p.payroll ?? null,
    acceptsPacks: p.acceptsPacks,
    profileHash: employerProfileHash(p),
    /* So a caller can tell "saved" from "was already that". The old route
       could not: it answered the same whether or not anything happened. */
    changed: pending.length,
    gaps,
    ready: gaps.length === 0,
  });
}
