/* ============================================================
   Rebuilding the task board from the trail.

   The same arrangement lib/shifts/replay.ts arrived at, for the
   same reason: a second durable store beside the chain is two
   copies of one fact, and two copies drift. So the board is the
   seed with every task event folded over it, and /audit and the
   board cannot disagree because they are the same data read twice.

   A move is not idempotent the way a claim is — moving a card to
   In Progress and back to To Do is two real events and the second
   is not a no-op. So the fold applies events in seq order and the
   last one wins, rather than collapsing them.
   ============================================================ */

import type { AuditEvent } from "@/lib/idara";
import { seedBoard } from "./seed";
import { COLS, isColName, type ColName, type TaskCard, type TaskBoard } from "./types";

/** Events that change what is on the board. */
export function isTaskEvent(e: AuditEvent): boolean {
  return e.type === "task.moved" || e.type === "task.created";
}

/** The shape a task event carries in `data`, once narrowed off the chain. */
interface TaskEventData {
  taskId?: unknown;
  to?: unknown;
  from?: unknown;
  card?: unknown;
}

function asCard(v: unknown): TaskCard | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.title !== "string") return null;
  return {
    id: c.id,
    title: c.title,
    sub: typeof c.sub === "string" ? c.sub : "",
    prio: c.prio === "High" || c.prio === "Medium" || c.prio === "Low" ? c.prio : null,
    due: typeof c.due === "string" ? c.due : null,
    names: Array.isArray(c.names) ? c.names.filter((n): n is string => typeof n === "string") : [],
    ...(typeof c.extra === "number" ? { extra: c.extra } : {}),
  };
}

/**
 * What a card looks like once it lands in a column.
 *
 * Completed strips the priority and restates the due date. This lives here
 * rather than at each call site because the drag handler, the ⋮ menu and the
 * replay all have to agree — and the replay is the one that decides what the
 * board says after a reload, so a rule the UI applied and the fold did not
 * would mean a card changed on refresh.
 */
export function cardInColumn(card: TaskCard, to: ColName): TaskCard {
  return to === "Completed" ? { ...card, prio: null, due: "Completed today" } : card;
}

/** Where a card currently sits, or null if the board has never heard of it. */
function locate(board: TaskBoard, id: string): ColName | null {
  for (const col of COLS) if (board[col].some((c) => c.id === id)) return col;
  return null;
}

/**
 * The board as of this log.
 *
 * Unknown ids are skipped rather than invented: an event naming a task the
 * seed does not contain and no creation introduced is a fact about a board
 * this deployment is not showing, and guessing a column for it would put a
 * card on screen that nothing can explain.
 */
export function replayTasks(log: AuditEvent[]): TaskBoard {
  const board = seedBoard();

  for (const e of [...log].sort((a, b) => a.seq - b.seq)) {
    if (!isTaskEvent(e)) continue;
    const d = (e.data ?? {}) as TaskEventData;

    if (e.type === "task.created") {
      const card = asCard(d.card);
      const to = d.to;
      if (!card || !isColName(to)) continue;
      if (locate(board, card.id)) continue; // already here; a replayed create is not a duplicate
      board[to] = [cardInColumn(card, to), ...board[to]];
      continue;
    }

    // task.moved
    const id = d.taskId;
    const to = d.to;
    if (typeof id !== "string" || !isColName(to)) continue;
    const from = locate(board, id);
    if (!from || from === to) continue;

    const card = board[from].find((c) => c.id === id);
    if (!card) continue;
    board[from] = board[from].filter((c) => c.id !== id);
    board[to] = [cardInColumn(card, to), ...board[to]];
  }

  return board;
}
