/* ============================================================
   People — the hospitality skill vocabulary
   Same shape as the credential pack in lib/idara/hospitality.ts:
   swapping verticals means swapping this file.
   ============================================================ */

import type { SkillId, SkillLevel } from "./types";

export interface SkillMeta {
  id: SkillId;
  label: string;
  /** lucide-react icon name. */
  icon: string;
}

export const SKILLS: Record<SkillId, SkillMeta> = {
  cocktails: { id: "cocktails", label: "Cocktails", icon: "martini" },
  till_pos: { id: "till_pos", label: "Till / POS", icon: "credit-card" },
  silver_service: { id: "silver_service", label: "Silver service", icon: "utensils-crossed" },
  wine_service: { id: "wine_service", label: "Wine service", icon: "wine" },
  plated_events: { id: "plated_events", label: "Plated events", icon: "chef-hat" },
  canapes: { id: "canapes", label: "Canapés", icon: "concierge-bell" },
  bump_in_out: { id: "bump_in_out", label: "Bump-in / bump-out", icon: "truck" },
};

/** Rank order — a higher level satisfies a lower requirement. */
const RANK: Record<SkillLevel, number> = { basic: 1, solid: 2, lead: 3 };

export const SKILL_LEVELS: SkillLevel[] = ["basic", "solid", "lead"];

/** Does `held` meet or exceed `wanted`? */
export function meetsLevel(held: SkillLevel | undefined, wanted: SkillLevel): boolean {
  return held !== undefined && RANK[held] >= RANK[wanted];
}

/** Held, but not to the level asked for — worth partial credit, not zero. */
export function belowLevel(held: SkillLevel | undefined, wanted: SkillLevel): boolean {
  return held !== undefined && RANK[held] < RANK[wanted];
}
