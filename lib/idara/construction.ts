/* ============================================================
   Idara — Construction vertical pack
   The credential taxonomy + site requirement presets for the
   construction suite. Swapping verticals = swapping this file;
   the engine, verifier and audit log are unchanged.
   ============================================================ */

import type { CredentialTypeId, CredentialRequirement } from "./types";

export interface CredentialTypeMeta {
  id: CredentialTypeId;
  label: string;
  shortLabel: string;
  /** lucide-react icon name. */
  icon: string;
  /** who normally issues this in Australian construction. */
  authority: string;
  /** does it carry an expiry date? */
  expires: boolean;
  /** re-issued per site (induction, SWMS) rather than portable. */
  siteScoped: boolean;
  description: string;
}

export const CREDENTIAL_TYPES: Record<CredentialTypeId, CredentialTypeMeta> = {
  white_card: {
    id: "white_card",
    label: "General Construction Induction (White Card)",
    shortLabel: "White Card",
    icon: "id-card",
    authority: "State WHS regulator",
    expires: false,
    siteScoped: false,
    description: "Mandatory to enter any construction workplace in Australia.",
  },
  high_risk_work: {
    id: "high_risk_work",
    label: "High Risk Work Licence",
    shortLabel: "HRW Licence",
    icon: "alert-triangle",
    authority: "State WHS regulator",
    expires: true,
    siteScoped: false,
    description: "Required for cranes, forklifts, rigging and similar classes.",
  },
  ewp_licence: {
    id: "ewp_licence",
    label: "Elevated Work Platform Licence",
    shortLabel: "EWP Licence",
    icon: "move-vertical",
    authority: "RTO / WHS regulator",
    expires: true,
    siteScoped: false,
    description: "Operate boom/scissor lifts above the licensed height class.",
  },
  working_at_heights: {
    id: "working_at_heights",
    label: "Working at Heights",
    shortLabel: "Heights",
    icon: "mountain",
    authority: "Registered Training Org",
    expires: true,
    siteScoped: false,
    description: "Required on sites with fall-risk work above 2m.",
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
    label: "Site Induction",
    shortLabel: "Site Induction",
    icon: "clipboard-check",
    authority: "Principal contractor (PCBU)",
    expires: true,
    siteScoped: true,
    description: "Site-specific induction; must match the site being entered.",
  },
  swms_ack: {
    id: "swms_ack",
    label: "SWMS Acknowledgement",
    shortLabel: "SWMS",
    icon: "file-check-2",
    authority: "Principal contractor (PCBU)",
    expires: true,
    siteScoped: true,
    description: "Safe Work Method Statement signed for the current works.",
  },
};

export const CREDENTIAL_ORDER: CredentialTypeId[] = [
  "white_card",
  "site_induction",
  "first_aid",
  "swms_ack",
  "working_at_heights",
  "high_risk_work",
  "ewp_licence",
];

/** Baseline every construction site demands. */
export const BASE_REQUIREMENTS: CredentialRequirement[] = [
  { type: "white_card" },
  { type: "site_induction", siteScoped: true },
  { type: "first_aid" },
];
