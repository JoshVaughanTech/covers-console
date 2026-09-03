/* ============================================================
   Role-scoped requirements: a requirement binds to what someone
   actually does on shift, not to everyone rostered. RSA is owed
   by whoever serves alcohol; the kitchen doesn't need one.

   The fail-safe direction matters most here. Getting this wrong
   in the permissive direction means a compliance tool quietly
   stops asking for a licence someone genuinely owes, so the
   unknown-role and empty-duty cases are pinned deliberately.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { decide } from "../lib/idara/engine";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import {
  ALL_WORK_FUNCTIONS,
  ROLE_FUNCTIONS,
  functionsForRole,
} from "../lib/idara/hospitality";
import type {
  Credential,
  CredentialTypeId,
  Identity,
  Site,
} from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();
const AT = "2024-05-16";

const person = (role: string): Identity => ({
  did: "did:web:idara.app:w:test-worker",
  name: "Test Worker",
  role,
  org: "Brightwater Hospitality",
});

let n = 0;
const cred = (type: CredentialTypeId, expiresAt: string | null): Credential => ({
  id: `vc-r${n++}`,
  type,
  subject: "did:web:idara.app:w:test-worker",
  issuer: "did:web:idara.app",
  issuedAt: "2023-01-15",
  expiresAt,
  status: "valid",
  claims: {},
});

/** Alcohol-only venue: one requirement, scoped to serving. */
const bar: Site = {
  id: "s-bar",
  name: "Test Bar",
  region: "Victoria",
  kind: "venue",
  requires: [{ type: "rsa", appliesTo: ["serve_alcohol"] }],
};

const run = (role: string, credentials: Credential[] = [], where: Site = bar) =>
  decide({
    person: person(role),
    credentials,
    action: "be_rostered",
    site: where,
    at: AT,
    verifier,
  });

describe("functionsForRole", () => {
  it("returns the mapped duties for a known role", () => {
    expect(functionsForRole("Head Chef")).toEqual(["handle_food", "supervise"]);
    expect(functionsForRole("Bartender")).toContain("serve_alcohol");
  });

  it("fails safe: an unmapped role is assumed to do everything", () => {
    expect(functionsForRole("Sommelier")).toEqual(ALL_WORK_FUNCTIONS);
    expect(functionsForRole("")).toEqual(ALL_WORK_FUNCTIONS);
  });

  it("distinguishes an explicitly empty duty list from an unknown role", () => {
    // a glassy clears tables — mapped, but performs none of the gated duties
    expect(ROLE_FUNCTIONS["Glassy"]).toEqual([]);
    expect(functionsForRole("Glassy")).toEqual([]);
    expect(functionsForRole("Glassy")).not.toEqual(ALL_WORK_FUNCTIONS);
  });

  it("only ever names known work functions", () => {
    for (const [role, fns] of Object.entries(ROLE_FUNCTIONS)) {
      for (const f of fns) {
        expect(ALL_WORK_FUNCTIONS, `${role} → ${f}`).toContain(f);
      }
    }
  });
});

describe("decide — role-scoped requirements", () => {
  it("demands RSA of someone who serves alcohol", () => {
    const d = run("Bartender");
    expect(d.allowed).toBe(false);
    expect(d.reasons[0].outcome).toBe("fail");
    expect(d.reasons[0].code).toBe("credential.missing");
  });

  it("does not demand RSA of the kitchen", () => {
    const d = run("Head Chef");
    expect(d.allowed).toBe(true);
    expect(d.reasons[0].outcome).toBe("n/a");
    expect(d.reasons[0].code).toBe("credential.not_applicable");
  });

  it("records the skipped requirement rather than dropping it", () => {
    const d = run("Head Chef");
    // still one entry per requirement — the trail shows what was considered
    expect(d.reasons).toHaveLength(bar.requires.length);
    expect(d.reasons[0].credentialType).toBe("rsa");
    expect(d.reasons[0].detail).toContain("Head Chef");
  });

  it("counts an n/a as neither a failure nor a warning", () => {
    const d = run("Head Chef");
    expect(d.warnings).toBe(0);
    expect(d.reasons.filter((r) => r.outcome === "fail")).toHaveLength(0);
  });

  it("still demands RSA of an unmapped role", () => {
    const d = run("Cellar Hand");
    expect(d.allowed).toBe(false);
    expect(d.reasons[0].outcome).toBe("fail");
  });

  it("skips every scoped requirement for a role with no gated duties", () => {
    const d = run("Glassy");
    expect(d.allowed).toBe(true);
    expect(d.reasons.every((r) => r.outcome === "n/a")).toBe(true);
  });

  it("an unscoped requirement binds to everyone, kitchen included", () => {
    const inducted: Site = {
      ...bar,
      requires: [{ type: "site_induction" }],
    };
    expect(run("Head Chef", [], inducted).allowed).toBe(false);
    expect(run("Glassy", [], inducted).allowed).toBe(false);
    expect(run("Bartender", [], inducted).allowed).toBe(false);
  });

  it("binds when the person performs any one of several listed duties", () => {
    const either: Site = {
      ...bar,
      requires: [{ type: "first_aid", appliesTo: ["gaming", "supervise"] }],
    };
    // Head Chef supervises but doesn't work gaming — one match is enough
    expect(run("Head Chef", [], either).allowed).toBe(false);
    // a bartender does neither
    expect(run("Bartender", [], either).reasons[0].outcome).toBe("n/a");
  });

  it("holding a credential you don't owe neither helps nor hurts", () => {
    const withRsa = run("Head Chef", [cred("rsa", "2026-01-01")]);
    const without = run("Head Chef", []);
    expect(withRsa.allowed).toBe(without.allowed);
    expect(withRsa.reasons[0].outcome).toBe("n/a");
  });

  it("does not warn about an expiring credential the person doesn't owe", () => {
    // RSA expiring in 3 days, but this chef was never required to hold it
    const d = run("Head Chef", [cred("rsa", "2024-05-19")]);
    expect(d.warnings).toBe(0);
    expect(d.allowed).toBe(true);
  });

  it("scoping decides applicability, not validity — a revoked RSA still blocks a bartender", () => {
    const revoked: Credential = { ...cred("rsa", "2026-01-01"), status: "revoked" };
    const d = run("Bartender", [revoked]);
    expect(d.allowed).toBe(false);
    expect(d.reasons[0].code).toBe("credential.revoked");
  });
});
