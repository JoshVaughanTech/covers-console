/* ============================================================
   People — public surface
   Workforce profile data: skills, ratings, availability, hours.
   Joins to Idara by DID; neither layer imports the other's
   vocabulary.
   ============================================================ */

export * from "./types";
export { SKILLS, SKILL_LEVELS, meetsLevel, belowLevel } from "./skills";
export type { SkillMeta } from "./skills";
export { PROFILES, profileOf } from "./seed";
