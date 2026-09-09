/* ============================================================
   The run sheet board, and moves against it.

   GET folds the chain over the seed; POST appends an event and
   returns the board that results. The response is the fold rather
   than an acknowledgement, so the screen cannot end up holding a
   board the chain disagrees with — the same reason /api/shifts
   returns state rather than "ok".

   Operator-gated, not worker-gated. A run sheet is the venue's
   working document; a casual on the floor has no business
   reordering it, and `operatorOf` is the check that says so.
   ============================================================ */

import { NextResponse } from "next/server";
import { operatorOf } from "@/lib/auth/session";
import { eventStore } from "@/lib/store/events";
import { replayTasks, isColName, COLS, type TaskCard } from "@/lib/tasks";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

export async function GET(req: Request) {
  const caller = await operatorOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const log = await (await eventStore()).all(ORG);
  return NextResponse.json({ board: replayTasks(log), columns: COLS });
}

/** A card off the wire, with only the fields this route is willing to store. */
function cardFromBody(v: unknown, id: string): TaskCard | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const title = typeof c.title === "string" ? c.title.trim() : "";
  if (!title) return null;
  return {
    id,
    title,
    sub: typeof c.sub === "string" ? c.sub.trim() : "",
    prio: c.prio === "High" || c.prio === "Medium" || c.prio === "Low" ? c.prio : null,
    due: typeof c.due === "string" ? c.due : null,
    names: Array.isArray(c.names) ? c.names.filter((n): n is string => typeof n === "string") : [],
  };
}

export async function POST(req: Request) {
  const caller = await operatorOf(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: { action?: unknown; taskId?: unknown; from?: unknown; to?: unknown; card?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const to = body.to;
  if (!isColName(to)) {
    return NextResponse.json({ error: "to must be a board column" }, { status: 400 });
  }

  const store = await eventStore();
  const log = await store.all(ORG);
  const before = replayTasks(log);

  if (body.action === "create") {
    /* The id is minted here, never accepted from the caller. A client-chosen
       id could collide with a seeded task and the fold would then skip the
       creation as "already present", losing a card with no error anywhere. */
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const card = cardFromBody(body.card, id);
    if (!card) return NextResponse.json({ error: "a task needs a title" }, { status: 400 });

    await store.append(ORG, {
      type: "task.created",
      at: new Date().toISOString(),
      actor: caller.operator.name,
      actorDid: caller.did,
      subject: caller.did,
      summary: `${caller.operator.name} added “${card.title}” to ${to}`,
      data: { card, to },
    });

    return NextResponse.json({ board: replayTasks(await store.all(ORG)) });
  }

  // default action: move
  const taskId = body.taskId;
  if (typeof taskId !== "string") {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  /* Where the card actually is, not where the client believed it was. A stale
     screen sending the wrong `from` should not be able to write an event that
     disagrees with the board — and two tabs open on one run sheet is the
     ordinary case rather than the exotic one. */
  const from = COLS.find((c) => before[c].some((t) => t.id === taskId));
  if (!from) return NextResponse.json({ error: "unknown task" }, { status: 404 });
  if (from === to) return NextResponse.json({ board: before });

  const card = before[from].find((t) => t.id === taskId)!;

  await store.append(ORG, {
    type: "task.moved",
    at: new Date().toISOString(),
    actor: caller.operator.name,
    actorDid: caller.did,
    subject: caller.did,
    summary: `${caller.operator.name} moved “${card.title}” to ${to}`,
    data: { taskId, from, to },
  });

  return NextResponse.json({ board: replayTasks(await store.all(ORG)) });
}
