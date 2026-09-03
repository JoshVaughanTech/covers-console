/* ============================================================
   Idara — Hospitality vertical pack
   The credential taxonomy + location requirement presets for the
   hospitality suite. Swapping verticals = swapping this file;
   the engine, verifier and audit log are unchanged.

   Covers both halves of the industry deliberately:
     • fixed venues      — pubs, taverns, bars, gaming rooms
     • off-premise work  — catering at weddings, functions, corporate
   Only `rsg` is venue-only (gaming is separately licensed). Every
   other credential travels with the worker to either kind of place,
   which is the whole portability argument.
   ============================================================ */

import type {
  CredentialTypeId,
  CredentialRequirement,
  WorkFunction,
} from "./types";

export interface CredentialTypeMeta {
  id: CredentialTypeId;
  label: string;
  shortLabel: string;
  /** lucide-react icon name. */
  icon: string;
  /** who normally issues this in Australian hospitality. */
  authority: string;
  /** does it carry an expiry date? */
  expires: boolean;
  /** re-issued per location (induction, briefing) rather than portable. */
  siteScoped: boolean;
  description: string;
}

export const CREDENTIAL_TYPES: Record<CredentialTypeId, CredentialTypeMeta> = {
  rsa: {
    id: "rsa",
    label: "Responsible Service of Alcohol",
    shortLabel: "RSA",
    icon: "wine",
    authority: "State liquor regulator (approved provider)",
    expires: true,
    siteScoped: false,
    description:
      "Mandatory for anyone serving or supplying alcohol, on-premise or at a catered event.",
  },
  rsg: {
    id: "rsg",
    label: "Responsible Service of Gaming",
    shortLabel: "RSG",
    icon: "dice-5",
    authority: "State gambling regulator",
    expires: true,
    siteScoped: false,
    description:
      "Required to work in a licensed gaming room or operate electronic gaming machines.",
  },
  food_safety_supervisor: {
    id: "food_safety_supervisor",
    label: "Food Safety Supervisor",
    shortLabel: "FSS",
    icon: "clipboard-check",
    authority: "Registered Training Org",
    expires: true,
    siteScoped: false,
    description:
      "Supervises food handling and temperature control — required wherever food is prepared or transported.",
  },
  food_handling: {
    id: "food_handling",
    label: "Food Handler Training",
    shortLabel: "Food Handling",
    icon: "utensils",
    authority: "Registered Training Org / employer",
    expires: true,
    siteScoped: false,
    description: "Baseline safe food handling for anyone preparing or serving food.",
  },
  allergen_management: {
    id: "allergen_management",
    label: "Allergen Management",
    shortLabel: "Allergen",
    icon: "shield-alert",
    authority: "Registered Training Org",
    expires: true,
    siteScoped: false,
    description:
      "Handling declared dietary requirements — critical for plated events and off-premise catering.",
  },
  first_aid: {
    id: "first_aid",
    label: "Provide First Aid (HLTAID011)",
    shortLabel: "First Aid",
    icon: "plus-square",
    authority: "Registered Training Org",
    expires: true,
    siteScoped: false,
    description: "Three-year first aid certification.",
  },
  site_induction: {
    id: "site_induction",
    label: "Site & Venue Induction",
    shortLabel: "Induction",
    icon: "map-pin-check",
    authority: "Licensee / operations manager",
    expires: true,
    siteScoped: true,
    description:
      "Venue induction for a fixed site, or the event briefing for an off-premise operation.",
  },
  wwcc: {
    id: "wwcc",
    label: "Working with Children Check",
    shortLabel: "WWCC",
    icon: "users",
    authority: "State screening unit",
    expires: true,
    siteScoped: false,
    description: "Required for school functions, kids' clubs and family events.",
  },
};

export const CREDENTIAL_ORDER: CredentialTypeId[] = [
  "rsa",
  "site_induction",
  "food_handling",
  "food_safety_supervisor",
  "allergen_management",
  "rsg",
  "first_aid",
  "wwcc",
];

/* ---------- roles → what they actually do ----------
   Requirements bind to duties, not titles. RSA is owed by whoever serves
   alcohol; a chef who never goes near the taps doesn't need one. Keeping the
   mapping here rather than in the engine means the engine still knows nothing
   about bars or kitchens. */

export const ALL_WORK_FUNCTIONS: WorkFunction[] = [
  "serve_alcohol",
  "handle_food",
  "gaming",
  "supervise",
];

export const ROLE_FUNCTIONS: Record<string, WorkFunction[]> = {
  "Venue Manager": ALL_WORK_FUNCTIONS,
  "Duty Manager": ALL_WORK_FUNCTIONS,
  "Events Coordinator": ["serve_alcohol", "handle_food", "supervise"],
  Bartender: ["serve_alcohol", "handle_food"],
  "Bar Attendant": ["serve_alcohol", "handle_food"],
  "Bar Supervisor": ["serve_alcohol", "handle_food", "supervise"],
  // a barback pours and restocks, so the licence still binds
  Barback: ["serve_alcohol"],
  "Wait Staff": ["serve_alcohol", "handle_food"],
  "Gaming Attendant": ["serve_alcohol", "gaming"],
  "Head Chef": ["handle_food", "supervise"],
  "Sous Chef": ["handle_food"],
  "Kitchen Hand": ["handle_food"],
  Barista: ["handle_food"],
  // glassies clear tables; they neither pour nor prepare
  Glassy: [],
};

/**
 * Duties for a role. An unrecognised title is assumed to do everything, so a
 * job title nobody has mapped yet fails safe — it can only ever be asked for
 * more than it needs, never less.
 */
export function functionsForRole(role: string): WorkFunction[] {
  return ROLE_FUNCTIONS[role] ?? ALL_WORK_FUNCTIONS;
}

/** Baseline every hospitality location demands. */
export const BASE_REQUIREMENTS: CredentialRequirement[] = [
  { type: "rsa", appliesTo: ["serve_alcohol"] },
  // everyone on site is inducted, whatever they're there to do
  { type: "site_induction", siteScoped: true },
  { type: "food_handling", appliesTo: ["handle_food"] },
];
