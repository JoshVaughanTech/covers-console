/* ============================================================
   The task board survives a reload.

   Before this, the run sheet was component state: a move looked
   like it worked and was gone on refresh. That is the failure
   lib/shifts/replay.ts already fixed once for postings — the
   chain said one thing and the screen said another, with nothing
   on screen to say which was right.

   So these pin the fold rather than the UI. If the board and
   /audit ever disagree again, one of these fails first.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { replayTasks, seedBoard, COLS, type ColName } from "../lib/tasks";
import type { AuditEvent } from "../lib/idara";

let seq = 0;
const ev = (type: string, data: Record<string, unknown>): AuditEvent =>
  ({
    seq: ++seq,
    type,
    at: "2024-05-16T00:00:00.000Z",
    actor: "Emma Taylor",
    subject: "did:web:idara.app:u:emma-taylor",
    summary: "",
    data,
    hash: "",
    prevHash: "",
  }) as unknown as AuditEvent;

const where = (board: ReturnType<typeof seedBoard>, id: string): ColName | null =>
  COLS.find((c) => board[c].some((t) => t.id === id)) ?? null;

describe("folding task events over the seed", () => {
  it("is the seed when nothing has happened", () => {
    expect(replayTasks([])).toEqual(seedBoard());
  });

  it("moves a card to the column the event names", () => {
    const b = replayTasks([ev("task.moved", { taskId: "t1", from: "To Do", to: "Review" })]);
    expect(where(b, "t1")).toBe("Review");
    expect(b["To Do"].some((c) => c.id === "t1")).toBe(false);
  });

  it("applies moves in seq order, so the last one wins", () => {
    // a card moved out and back is two real events, not a no-op pair
    const b = replayTasks([
      ev("task.moved", { taskId: "t2", from: "To Do", to: "Completed" }),
      ev("task.moved", { taskId: "t2", from: "Completed", to: "To Do" }),
    ]);
    expect(where(b, "t2")).toBe("To Do");
  });

  it("orders by seq even when the log arrives shuffled", () => {
    const first = ev("task.moved", { taskId: "t3", from: "To Do", to: "Review" });
    const second = ev("task.moved", { taskId: "t3", from: "Review", to: "In Progress" });
    expect(where(replayTasks([second, first]), "t3")).toBe("In Progress");
  });

  it("does nothing when the move names the column the card is already in", () => {
    /* Found by scripts/mutate.mjs: dropping the `from === to` half of the guard
       left every case green. Without it the card is filtered out of its column
       and prepended back, so a no-op move silently reorders the board — and for
       Completed it also rewrites the card through cardInColumn(), turning a due
       date of null into "Completed today".

       A stale tab re-sending a move it already sent is the ordinary way this
       happens, and the board it produces is wrong in a way nobody would look
       for, because nothing on screen says a move was applied twice. */
    const before = replayTasks([]);
    const after = replayTasks([ev("task.moved", { taskId: "t7", from: "Completed", to: "Completed" })]);
    expect(after).toEqual(before);
  });

  it("strips the priority when a card lands in Completed", () => {
    const b = replayTasks([ev("task.moved", { taskId: "t1", from: "To Do", to: "Completed" })]);
    const card = b.Completed.find((c) => c.id === "t1");
    expect(card?.prio).toBeNull();
    expect(card?.due).toBe("Completed today");
  });

  it("trusts where the card actually is, not the `from` on the event", () => {
    /* A stale tab can send a wrong `from`. The fold locates the card itself, so
       the move still lands correctly rather than dropping silently. */
    const b = replayTasks([ev("task.moved", { taskId: "t4", from: "Review", to: "Completed" })]);
    expect(where(b, "t4")).toBe("Completed");
  });

  it("adds a created card to the named column", () => {
    const card = { id: "tX", title: "Chase the florist", sub: "Front of house", prio: "High", due: "May 19", names: [] };
    const b = replayTasks([ev("task.created", { card, to: "In Progress" })]);
    expect(where(b, "tX")).toBe("In Progress");
    expect(b["In Progress"][0].title).toBe("Chase the florist");
  });

  it("can move a card that was created by an earlier event", () => {
    const card = { id: "tY", title: "Confirm PA hire", sub: "AV", prio: "Low", due: "May 19", names: [] };
    const b = replayTasks([
      ev("task.created", { card, to: "To Do" }),
      ev("task.moved", { taskId: "tY", from: "To Do", to: "Review" }),
    ]);
    expect(where(b, "tY")).toBe("Review");
  });

  it("does not duplicate a card if its creation is folded twice", () => {
    const card = { id: "tZ", title: "Print seating chart", sub: "FOH", prio: "Low", due: "May 19", names: [] };
    const e = ev("task.created", { card, to: "To Do" });
    const b = replayTasks([e, e]);
    expect(b["To Do"].filter((c) => c.id === "tZ")).toHaveLength(1);
  });
});

describe("what the fold refuses to invent", () => {
  it("skips a move naming a task it has never seen", () => {
    // rather than materialise a card nothing can explain
    const b = replayTasks([ev("task.moved", { taskId: "nope", from: "To Do", to: "Review" })]);
    expect(b).toEqual(seedBoard());
  });

  it("skips an event whose column is not a column", () => {
    const b = replayTasks([ev("task.moved", { taskId: "t1", from: "To Do", to: "Archived" })]);
    expect(where(b, "t1")).toBe("To Do");
  });

  it("skips a creation with no usable card", () => {
    const b = replayTasks([ev("task.created", { card: { id: "t99" }, to: "To Do" })]);
    expect(b).toEqual(seedBoard());
  });

  it("ignores events that are not task events", () => {
    const b = replayTasks([ev("shift.claimed", { taskId: "t1", to: "Review" })]);
    expect(b).toEqual(seedBoard());
  });

  it("leaves the seed untouched so a second fold starts clean", () => {
    replayTasks([ev("task.moved", { taskId: "t1", from: "To Do", to: "Completed" })]);
    expect(where(seedBoard(), "t1")).toBe("To Do");
  });
});
