/* ============================================================
   People — demo profiles for the ten seeded staff
   Deliberately uneven: different skill spreads, ratings and hours,
   so the matcher has something real to rank and its explanations
   differ person to person.

   Hours are "already rostered this week" against a 38h full week,
   which is what makes Sophie and Leanne read as overtime risks.
   ============================================================ */

import { WORKERS } from "@/lib/idara";
import type { StaffProfile } from "./types";

const W = Object.fromEntries(WORKERS.map((w) => [w.name, w.did])) as Record<string, string>;

export const PROFILES: StaffProfile[] = [
  {
    did: W["Darie Roberts"],
    rating: 4.4,
    homeSiteId: "s-brightwater",
    skills: { cocktails: "solid", till_pos: "solid", wine_service: "basic" },
    hoursThisWeek: 22,
    award: { level: 2, employment: "casual" },
  },
  {
    // rated highest, but already near a full week — the matcher should
    // surface that rather than let a 4.9 carry her onto a sixth shift
    did: W["Leanne Vidal"],
    rating: 4.9,
    homeSiteId: "s-brightwater",
    skills: { till_pos: "lead", wine_service: "solid", silver_service: "solid" },
    hoursThisWeek: 38,
    award: { level: 5, employment: "full_time" },
  },
  {
    did: W["Mitch Egan"],
    rating: 4.2,
    homeSiteId: "s-brightwater-gaming",
    skills: { till_pos: "solid", cocktails: "basic" },
    hoursThisWeek: 12,
    award: { level: 2, employment: "casual" },
  },
  {
    did: W["Aaron Patel"],
    rating: 4.6,
    homeSiteId: "s-brightwater",
    skills: { cocktails: "solid", wine_service: "solid" },
    hoursThisWeek: 8,
    award: { level: 2, employment: "casual" },
  },
  {
    did: W["Sophie Nguyen"],
    rating: 4.9,
    homeSiteId: "s-brightwater",
    skills: { till_pos: "lead", silver_service: "lead", wine_service: "solid" },
    hoursThisWeek: 41,
    award: { level: 5, employment: "full_time" },
  },
  {
    // the demo's blocked worker: strong on paper, gated by a lapsed RSA
    did: W["Jake Morrison"],
    rating: 3.9,
    homeSiteId: "s-northside",
    skills: { cocktails: "solid", till_pos: "solid", bump_in_out: "lead" },
    hoursThisWeek: 15,
    award: { level: 2, employment: "casual" },
  },
  {
    did: W["Hassan Ali"],
    rating: 4.7,
    homeSiteId: "s-brightwater",
    skills: { plated_events: "lead", canapes: "solid" },
    hoursThisWeek: 36,
    award: { level: 5, employment: "full_time" },
  },
  {
    did: W["Liam O'Brien"],
    rating: 3.6,
    homeSiteId: "s-brightwater",
    skills: { bump_in_out: "solid" },
    hoursThisWeek: 18,
    award: { level: 1, employment: "casual" },
  },
  {
    did: W["Priya Sharma"],
    rating: 4.8,
    homeSiteId: "s-werribee-wedding",
    skills: { silver_service: "lead", plated_events: "solid", wine_service: "solid", canapes: "solid" },
    hoursThisWeek: 20,
    award: { level: 3, employment: "part_time" },
  },
  {
    // excluded by a client after a prior engagement — a business rule,
    // not an eligibility failure, and shown as such
    did: W["Michael Tan"],
    rating: 4.1,
    homeSiteId: "s-brightwater",
    skills: { silver_service: "solid", canapes: "basic" },
    excludedClients: ["Meridian Group"],
    hoursThisWeek: 26,
    award: { level: 2, employment: "casual" },
  },
];

const INDEX = new Map(PROFILES.map((p) => [p.did, p]));

export function profileOf(did: string): StaffProfile | undefined {
  return INDEX.get(did);
}
