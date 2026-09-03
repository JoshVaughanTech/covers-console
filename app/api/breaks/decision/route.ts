/* ============================================================
   POST /api/breaks/decision — send someone on a break.

   One endpoint owns the whole two-phase write so no client can get it
   half-right: append the decision, push it to Connecteam, append the
   outcome. A phone that loses signal mid-request retries with the
   same clientRef and gets the original back rather than sending
   anyone on a second break.
   ============================================================ */
import { NextResponse } from "next/server";
import { eventStore } from "@/lib/store/events";
import { sendOnBreak, type BreakPusher, type BreakDecisionInput } from "@/lib/store/decision";
import { ConnecteamClient } from "@/lib/integrations/connecteam";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

const CT = {
  clientId: process.env.CONNECTEAM_CLIENT_ID,
  clientSecret: process.env.CONNECTEAM_CLIENT_SECRET,
  apiKey: process.env.CONNECTEAM_API_KEY,
  timeClockId: process.env.CONNECTEAM_TIME_CLOCK_ID,
  mealBreakId: process.env.CONNECTEAM_MEAL_BREAK_ID,
  restBreakId: process.env.CONNECTEAM_REST_BREAK_ID,
};

/**
 * Writing a break into Connecteam needs more than read credentials: it needs
 * the break-type ids to clock into, and a write scope the integration may not
 * hold. Absent either, the decision is still recorded — and reported as
 * "skipped" so the UI can say the timesheet was not updated rather than imply
 * that it was.
 */
function connecteamPusher(): BreakPusher {
  const configured = Boolean(
    CT.timeClockId &&
      (CT.apiKey || (CT.clientId && CT.clientSecret)) &&
      (CT.mealBreakId || CT.restBreakId),
  );

  return {
    available: () => configured,
    async push(input: BreakDecisionInput) {
      const breakId = input.kind === "meal" ? CT.mealBreakId : CT.restBreakId;
      if (!breakId) throw new Error(`no Connecteam break type configured for a ${input.kind} break`);

      const client = new ConnecteamClient({
        clientId: CT.clientId,
        clientSecret: CT.clientSecret,
        apiKey: CT.apiKey,
        timeClockId: CT.timeClockId as string,
        timezone: process.env.TZ_VENUE ?? "Australia/Melbourne",
      });
      return client.startBreak(breakId, input.subject, input.at);
    },
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<BreakDecisionInput> | null;

  if (!body?.subject || !body.name || !body.kind || !body.at || !body.actor) {
    return NextResponse.json(
      { error: "subject, name, kind, at and actor are required" },
      { status: 400 },
    );
  }
  if (body.kind !== "meal" && body.kind !== "rest") {
    return NextResponse.json({ error: "kind must be meal or rest" }, { status: 400 });
  }

  const result = await sendOnBreak(eventStore(), ORG, connecteamPusher(), body as BreakDecisionInput);

  // 200 on a replay, 201 on a genuinely new decision — a retrying client can
  // tell the difference without treating either as an error
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}
