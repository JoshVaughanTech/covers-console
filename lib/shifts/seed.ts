/* ============================================================
   Shifts — the demo's open postings
   Spread across in-house venue work and client-paid off-premise
   catering, so the client-preference component has somewhere to
   apply and somewhere to be correctly absent.
   ============================================================ */

import { WORKERS } from "@/lib/idara";
import type { ShiftPosting } from "./types";

const W = Object.fromEntries(WORKERS.map((w) => [w.name, w.did])) as Record<string, string>;

export const POSTINGS: ShiftPosting[] = [
  {
    id: "sp-2038-wait",
    role: "Wait Staff",
    seats: 2,
    functionName: "Docklands Corporate Lunch",
    functionRef: "FN-2038",
    client: "Meridian Group",
    siteId: "s-docklands-lunch",
    day: "Fri, 17 May",
    window: "10:30–15:30",
    shiftId: "Fri",
    duties: ["serve_alcohol", "handle_food"],
    requires: [
      { skill: "silver_service", level: "solid" },
      { skill: "wine_service", level: "solid" },
    ],
    claims: [{ did: W["Priya Sharma"], at: "2024-05-16" }],
    assigned: [W["Leanne Vidal"]],
    status: "open",
  },
  {
    // in-house: no client, so client preference correctly never applies
    id: "sp-fridaylive-bar",
    role: "Bartender",
    seats: 3,
    functionName: "Brightwater Friday Live",
    siteId: "s-brightwater",
    day: "Fri, 17 May",
    window: "17:00–01:00",
    shiftId: "Fri",
    duties: ["serve_alcohol", "handle_food"],
    requires: [
      { skill: "cocktails", level: "solid" },
      { skill: "till_pos", level: "solid" },
    ],
    claims: [{ did: W["Aaron Patel"], at: "2024-05-16" }],
    assigned: [W["Darie Roberts"]],
    status: "open",
  },
  {
    id: "sp-2041-wait",
    role: "Wait Staff",
    seats: 3,
    functionName: "Werribee Park Wedding",
    functionRef: "FN-2041",
    client: "Nguyen & Cole (private)",
    siteId: "s-werribee-wedding",
    day: "Sat, 18 May",
    window: "15:00–23:30",
    shiftId: "Sat",
    duties: ["serve_alcohol", "handle_food"],
    requires: [
      { skill: "silver_service", level: "solid" },
      { skill: "plated_events", level: "solid" },
      { skill: "wine_service", level: "basic" },
    ],
    claims: [
      { did: W["Mitch Egan"], at: "2024-05-16" },
      // claimed while his RSA was good; it was revoked afterwards. The request
      // was fine when made — the facts moved, which is the case the review
      // exists to surface rather than leave sitting in the queue.
      { did: W["Michael Tan"], at: "2024-05-10" },
    ],
    assigned: [W["Priya Sharma"]],
    status: "open",
  },
  {
    id: "sp-2041-bar",
    role: "Bartender",
    seats: 2,
    functionName: "Werribee Park Wedding",
    functionRef: "FN-2041",
    client: "Nguyen & Cole (private)",
    siteId: "s-werribee-wedding",
    day: "Sat, 18 May",
    window: "16:00–00:00",
    shiftId: "Sat",
    duties: ["serve_alcohol"],
    requires: [
      { skill: "cocktails", level: "lead" },
      { skill: "wine_service", level: "solid" },
    ],
    claims: [],
    assigned: [],
    status: "open",
  },
  {
    id: "sp-quayside-wait",
    role: "Wait Staff",
    seats: 4,
    functionName: "Quayside Product Launch",
    client: "Aperture Studios",
    siteId: "s-quayside",
    day: "Sun, 19 May",
    window: "17:30–22:00",
    shiftId: "Sun",
    duties: ["serve_alcohol", "handle_food"],
    requires: [{ skill: "canapes", level: "solid" }],
    claims: [],
    assigned: [],
    status: "draft",
  },
];
