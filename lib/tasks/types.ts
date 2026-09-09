/* ============================================================
   Run sheet tasks — the cards on the board.

   Lifted out of app/(console)/projects/page.tsx, where they were
   component state with no type behind them. That was fine while a
   move meant nothing; it stops being fine the moment a move has to
   survive a reload, because two places would then hold an opinion
   about what a task is.
   ============================================================ */

export type ColName = "To Do" | "In Progress" | "Review" | "Completed";

export const COLS: ColName[] = ["To Do", "In Progress", "Review", "Completed"];

export type Priority = "High" | "Medium" | "Low";

export interface TaskCard {
  id: string;
  title: string;
  /** the line under the title: a client, a location, a count. */
  sub: string;
  /** null once completed — a finished task has no priority left to have. */
  prio: Priority | null;
  due: string | null;
  /** display names for the avatar stack; not DIDs, these are not gated. */
  names: string[];
  /** how many assignees beyond the ones the stack shows. */
  extra?: number;
}

/** Where every card currently sits. */
export type TaskBoard = Record<ColName, TaskCard[]>;

/** True when `col` is a column this board has. Guards a value off the wire. */
export function isColName(v: unknown): v is ColName {
  return typeof v === "string" && (COLS as string[]).includes(v);
}
