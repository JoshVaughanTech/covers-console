/* ============================================================
   GET  /api/pack — the worker's own employment pack.
   POST /api/pack — nominate where the tax-free threshold is claimed.

   Worker sessions only, and it is their pack or nothing: the did
   comes from the session and there is no parameter that could name
   somebody else's. That is not a policy decision to be revisited —
   a pack endpoint that accepted a did would be an endpoint for
   reading other people's tax and banking status.

   What comes back is deliberately thin. Kinds, labels, states,
   dates, hashes: enough for somebody to see what is verified and
   what is missing, and not one payload. The values themselves are
   in the vault and leave it in exactly one place, which is
   provision().
   ============================================================ */
import { NextResponse } from "next/server";
import { workerOf } from "@/lib/auth/session";
import { eventStore } from "@/lib/store/events";
import { packOf } from "@/lib/idara/pack-seed";
import {
  PACK_ITEM_META,
  PACK_ITEM_ORDER,
  completenessOf,
  itemOf,
  stateOf,
  thresholdNotice,
} from "@/lib/idara/pack";
import { EMPLOYERS, employerOf } from "@/lib/idara/employer-seed";
import { engagementsFor } from "@/lib/idara/engagement";
import { TODAY } from "@/lib/idara/seed";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

export async function GET(req: Request) {
  const caller = workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const pack = packOf(caller.did);
  if (!pack) return NextResponse.json({ error: "no pack" }, { status: 404 });

  const at = TODAY;
  const completeness = completenessOf(pack, at);

  const items = PACK_ITEM_ORDER.map((kind) => {
    const meta = PACK_ITEM_META[kind];
    const item = itemOf(pack, kind);
    return {
      kind,
      label: meta.label,
      blurb: meta.blurb,
      sensitivity: meta.sensitivity,
      required: meta.required,
      verifiedBy: meta.verifiedBy,
      state: item ? stateOf(item, at) : "missing",
      verifiedAt: item?.verifiedAt ?? null,
      expiresAt: item?.expiresAt ?? null,
      /* The hash is shown. It is the one thing about a restricted item that
         can be displayed without disclosing it, and it is what makes
         "verified" checkable rather than asserted — an auditor holding the
         engagement can compare this against the snapshot it pinned. */
      hash: item?.hash ?? null,
    };
  });

  /* Every release this worker's pack has ever made, newest first.

     §10 of the design: workers can see where their details went. Assembled
     from the chain rather than from a table, so it cannot be quietly shorter
     than what happened. */
  const engagements = engagementsFor(eventStore().all(ORG), caller.did);
  const releases = engagements
    .flatMap((e) =>
      e.releases.map((r) => ({
        item: r.item,
        label: PACK_ITEM_META[r.item]?.label ?? r.item,
        toConnector: r.toConnector,
        at: r.at,
        engagementId: e.id,
        employer: employerOf(e.employerDid)?.tradingName ?? e.employerDid,
      })),
    )
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const primary = pack.primaryEmployerDid ? employerOf(pack.primaryEmployerDid) : undefined;

  return NextResponse.json({
    worker: { did: caller.person.did, name: caller.person.name, role: caller.person.role },
    at,
    agreementTemplateVersion: pack.agreementTemplateVersion,
    completeness: {
      ok: completeness.ok,
      progress: completeness.progress,
      held: completeness.held.length,
      required: completeness.held.length + completeness.missing.length,
      missing: completeness.missing.map((kind) => ({
        kind,
        label: PACK_ITEM_META[kind].label,
        blurb: PACK_ITEM_META[kind].blurb,
      })),
      expiringSoon: completeness.expiringSoon.map((e) => ({
        ...e,
        label: PACK_ITEM_META[e.kind].label,
      })),
    },
    items,
    threshold: {
      primaryEmployerDid: pack.primaryEmployerDid ?? null,
      primaryEmployerName: primary?.tradingName ?? null,
      /* Every employer the worker could nominate, with the warning each
         choice carries. The screen shows the consequence next to the choice
         rather than after it. */
      options: EMPLOYERS.map((e) => ({
        did: e.did,
        name: e.tradingName,
        current: e.did === pack.primaryEmployerDid,
        notice: thresholdNotice(pack, e.did, e.tradingName),
      })),
    },
    releases,
  });
}

interface ThresholdBody {
  primaryEmployerDid?: unknown;
}

/**
 * Nominate the employer the threshold is claimed with.
 *
 * The one thing on a pack a worker can change from a phone, and it is theirs
 * to change: which employer pays them most is their knowledge. Null clears
 * the nomination, which withholds at the higher rate everywhere — the safe
 * direction, and refundable.
 *
 * Held in the process's pack store, which is where the demo keeps packs. That
 * is the seam a durable pack store slots into; nothing above this line
 * changes when it does.
 */
export async function POST(req: Request) {
  const caller = workerOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const pack = packOf(caller.did);
  if (!pack) return NextResponse.json({ error: "no pack" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as ThresholdBody | null;
  const did = body?.primaryEmployerDid;

  if (did === null) {
    delete pack.primaryEmployerDid;
    return NextResponse.json({ primaryEmployerDid: null });
  }

  if (typeof did !== "string" || !employerOf(did)) {
    return NextResponse.json({ error: "unknown employer" }, { status: 400 });
  }

  pack.primaryEmployerDid = did;
  return NextResponse.json({
    primaryEmployerDid: did,
    /* Only future engagements. One already signed carries the answer it was
       signed with, because that is what was lodged with the ATO — rewriting it
       here would make the credential disagree with the declaration. */
    note: "Applies to engagements you accept from now on.",
  });
}
