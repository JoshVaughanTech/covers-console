/* ============================================================
   The run sheet the demo starts from.

   This is the base the chain is folded over — the same arrangement
   as lib/shifts/seed.ts and replayPostings(). Current state is the
   seed plus every consequential event, so the board and /audit
   cannot disagree: they are the same data read twice.
   ============================================================ */

import type { ColName, TaskBoard } from "./types";

export const TASK_SEED: TaskBoard = {
  "To Do": [
    { id: "t1", title: "Confirm final guest numbers", sub: "Client — Nguyen & Cole", prio: "High", due: "May 20", names: ["Priya Sharma"] },
    { id: "t2", title: "Place beverage order", sub: "Cellar — bar stock", prio: "Medium", due: "May 21", names: ["Ben Cole"] },
    { id: "t3", title: "Print menus & place cards", sub: "Front of house", prio: "Low", due: "May 22", names: ["Ana Reed"] },
  ],
  "In Progress": [
    { id: "t4", title: "Confirm dietary requirements", sub: "38 guests flagged", prio: "High", due: "May 18", names: ["Cara Vu", "Dan Fox"], extra: 2 },
    { id: "t5", title: "Marquee bar setup", sub: "Garden lawn", prio: "Medium", due: "May 18", names: ["Eve Ho"] },
  ],
  Review: [
    { id: "t6", title: "Allergen sign-off — plated main", sub: "Kitchen", prio: "Medium", due: "May 17", names: ["Gus Ray", "Ben Cole"], extra: 1 },
  ],
  Completed: [
    { id: "t7", title: "Site inspection — Werribee Park", sub: "Completed on May 12", prio: null, due: null, names: [] },
    { id: "t8", title: "Menu tasting with client", sub: "Completed on May 13", prio: null, due: null, names: [] },
    { id: "t9", title: "Staff briefing & rosters issued", sub: "Completed on May 14", prio: null, due: null, names: [] },
  ],
};

/**
 * The backlog the board does not draw.
 *
 * Column headers count these too, so the numbers describe a real run sheet
 * rather than the handful of cards that fit on screen. Kept beside the seed
 * because it is the same fiction: change one without the other and the
 * headers stop matching the cards under them.
 */
export const BASE_EXTRA: Record<ColName, number> = {
  "To Do": 9,
  "In Progress": 6,
  Review: 4,
  Completed: 23,
};

/** A fresh copy, so a caller folding events cannot mutate the seed itself. */
export function seedBoard(): TaskBoard {
  return {
    "To Do": [...TASK_SEED["To Do"]],
    "In Progress": [...TASK_SEED["In Progress"]],
    Review: [...TASK_SEED.Review],
    Completed: [...TASK_SEED.Completed],
  };
}
