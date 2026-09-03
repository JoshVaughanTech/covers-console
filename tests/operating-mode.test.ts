import { describe, it, expect } from "vitest";
import { SITES } from "../lib/idara/seed";
import { functionsForRole } from "../lib/idara/hospitality";
import { SEED_EVENTS } from "../lib/events";

/* ============================================================
   Site.kind, and the rename that could have failed silently.

   The eligibility engine looks duties up by role string. Renaming a
   job title without moving the mapping key would not throw, would
   not fail a type check, and would not break a page — it would just
   quietly return no duties, and quietly change who is allowed to
   work. That is the failure this file exists to catch.
   ============================================================ */

describe("Site.kind", () => {
  it("classifies every seeded site", () => {
    for (const s of SITES) {
      expect(s.kind, `${s.name} has no kind`).toMatch(/^(venue|catering)$/);
    }
  });

  it("splits the seed four venues to two catering operations", () => {
    const venues = SITES.filter((s) => s.kind === "venue").map((s) => s.name);
    const catering = SITES.filter((s) => s.kind === "catering").map((s) => s.name);
    expect(venues).toEqual([
      "Brightwater Hotel",
      "Brightwater Gaming Room",
      "Northside Tavern",
      "Quayside Bar & Kitchen",
    ]);
    expect(catering).toEqual(["Werribee Park Wedding", "Docklands Corporate Lunch"]);
  });

  it("derives org behaviour from the sites rather than a stored setting", () => {
    const allCatering = (sites: { kind: string }[]) => sites.every((s) => s.kind === "catering");
    // the demo org runs both, so it is not a pure caterer
    expect(allCatering(SITES)).toBe(false);
    expect(allCatering(SITES.filter((s) => s.kind === "catering"))).toBe(true);
    expect(allCatering(SITES.filter((s) => s.kind === "venue"))).toBe(false);
  });
});

describe("the Functions → Events rename did not change eligibility", () => {
  it("keeps the duty mapping for the renamed coordinator role", () => {
    expect(functionsForRole("Events Coordinator")).toEqual([
      "serve_alcohol",
      "handle_food",
      "supervise",
    ]);
  });

  it("over-gates an unmapped role rather than under-gating it", () => {
    // the engine falls back to every duty for a title it does not know, so a
    // rename that missed a key would make someone require MORE credentials and
    // show as Blocked — loud, not silent. Worth pinning: it is what makes the
    // rename safe, and it is the opposite of what the design doc assumed.
    const unmapped = functionsForRole("Nobody Has Mapped This");
    expect(unmapped.length).toBeGreaterThan(3);
    expect(functionsForRole("Functions Coordinator")).toEqual(unmapped);
  });

  it("gives the renamed role its specific duties, not the fallback", () => {
    // if the mapping key had not moved with the title, this would return the
    // full fallback set instead of these three
    expect(functionsForRole("Events Coordinator")).not.toEqual(
      functionsForRole("Nobody Has Mapped This"),
    );
  });

});

describe("events join to sites", () => {
  it("only ever references a site that exists", () => {
    const ids = new Set(SITES.map((s) => s.id));
    for (const e of SEED_EVENTS) {
      if (e.siteId) expect(ids.has(e.siteId), `${e.name} -> ${e.siteId}`).toBe(true);
    }
  });

  it("leaves one-off off-premise engagements unattached", () => {
    // a wedding at a hired mansion has a place but not a standing site;
    // inventing one would be worse than an honest absence
    const loose = SEED_EVENTS.filter((e) => !e.siteId);
    expect(loose.length).toBeGreaterThan(0);
    for (const e of loose) expect(e.site).not.toBe("");
  });

  it("gives both catering sites a week to show", () => {
    for (const site of SITES.filter((s) => s.kind === "catering")) {
      const mine = SEED_EVENTS.filter((e) => e.siteId === site.id);
      expect(mine.length, `${site.name} has no engagements`).toBeGreaterThan(0);
    }
  });
});
