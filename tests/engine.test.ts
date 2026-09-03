import { describe, it, expect } from "vitest";
import { decide, summarise, EXPIRY_WARN_DAYS } from "../lib/idara/engine";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import { BASE_REQUIREMENTS } from "../lib/idara/hospitality";
import type {
  Credential,
  CredentialTypeId,
  Identity,
  Site,
} from "../lib/idara/types";

const verifier = new LocalCredentialVerifier();
const AT = "2024-05-16";

const person: Identity = {
  did: "did:web:idara.app:w:test-worker",
  name: "Test Worker",
  role: "Bartender",
  org: "Brightwater Hospitality",
};

const site: Site = {
  id: "s-test",
  name: "Test Site",
  region: "Victoria",
  kind: "venue",
  requires: BASE_REQUIREMENTS, // rsa + site_induction@site + food_handling
};

let n = 0;
function cred(
  type: CredentialTypeId,
  expiresAt: string | null,
  over: Partial<Credential> = {},
): Credential {
  return {
    id: `vc-t${n++}`,
    type,
    subject: person.did,
    issuer: "did:web:idara.app",
    issuedAt: "2023-01-15",
    expiresAt,
    status: "valid",
    claims: {},
    ...over,
  };
}

/** A fully compliant credential set for `site`. */
const clean = (): Credential[] => [
  cred("rsa", null),
  cred("site_induction", "2025-01-01", { claims: { siteId: "s-test" } }),
  cred("food_handling", "2026-01-01"),
];

const run = (credentials: Credential[], where: Site = site) =>
  decide({ person, credentials, action: "be_rostered", site: where, at: AT, verifier });

describe("decide — the eligibility primitive", () => {
  it("allows a worker holding every required credential", () => {
    const d = run(clean());
    expect(d.allowed).toBe(true);
    expect(d.warnings).toBe(0);
    expect(d.reasons).toHaveLength(3);
    expect(d.reasons.every((r) => r.outcome === "pass")).toBe(true);
  });

  it("blocks a worker with no credentials at all, naming every gap", () => {
    const d = run([]);
    expect(d.allowed).toBe(false);
    expect(d.reasons).toHaveLength(3);
    expect(d.reasons.every((r) => r.code === "credential.missing")).toBe(true);
  });

  it("blocks on a missing credential", () => {
    const d = run(clean().filter((c) => c.type !== "food_handling"));
    expect(d.allowed).toBe(false);
    const fail = d.reasons.find((r) => r.outcome === "fail");
    expect(fail?.code).toBe("credential.missing");
    expect(fail?.credentialType).toBe("food_handling");
  });

  it("blocks on an expired credential", () => {
    const creds = clean();
    creds[2] = cred("food_handling", "2023-11-01");
    const d = run(creds);
    expect(d.allowed).toBe(false);
    expect(d.reasons.find((r) => r.outcome === "fail")?.code).toBe("credential.expired");
  });

  it("blocks on a revoked credential", () => {
    const creds = clean();
    creds[0] = cred("rsa", null, { status: "revoked" });
    const d = run(creds);
    expect(d.allowed).toBe(false);
    expect(d.reasons.find((r) => r.outcome === "fail")?.code).toBe("credential.revoked");
  });

  it("blocks on a suspended credential", () => {
    const creds = clean();
    creds[0] = cred("rsa", null, { status: "suspended" });
    const d = run(creds);
    expect(d.allowed).toBe(false);
    expect(d.reasons.find((r) => r.outcome === "fail")?.code).toBe("credential.suspended");
  });

  it("reports every failure, not just the first", () => {
    const d = run([cred("rsa", null)]);
    expect(d.allowed).toBe(false);
    expect(d.reasons.filter((r) => r.outcome === "fail")).toHaveLength(2);
  });
});

describe("decide — site scoping", () => {
  it("rejects a site induction issued for a different site", () => {
    const creds = clean();
    creds[1] = cred("site_induction", "2025-01-01", {
      claims: { siteId: "s-somewhere-else" },
    });
    const d = run(creds);
    expect(d.allowed).toBe(false);
    const fail = d.reasons.find((r) => r.outcome === "fail");
    expect(fail?.code).toBe("credential.missing");
    expect(fail?.credentialType).toBe("site_induction");
  });

  it("accepts a portable credential regardless of site claims", () => {
    // rsa is not siteScoped, so a stray siteId claim is irrelevant
    const creds = clean();
    creds[0] = cred("rsa", null, { claims: { siteId: "s-elsewhere" } });
    expect(run(creds).allowed).toBe(true);
  });

  it("enforces the extra requirement on a stricter site", () => {
    const stricterSite: Site = {
      ...site,
      requires: [...BASE_REQUIREMENTS, { type: "allergen_management" }],
    };
    expect(run(clean(), stricterSite).allowed).toBe(false);
    expect(
      run([...clean(), cred("allergen_management", "2025-08-01")], stricterSite).allowed,
    ).toBe(true);
  });
});

describe("decide — expiry warnings", () => {
  const daysFromAt = (days: number) =>
    new Date(Date.parse(AT) + days * 86_400_000).toISOString().slice(0, 10);

  it("warns but still allows inside the warning window", () => {
    const creds = clean();
    creds[2] = cred("food_handling", daysFromAt(EXPIRY_WARN_DAYS - 1));
    const d = run(creds);
    expect(d.allowed).toBe(true);
    expect(d.warnings).toBe(1);
    expect(d.reasons.find((r) => r.outcome === "warn")?.code).toBe("credential.expiring");
  });

  it("warns exactly at the window boundary", () => {
    const creds = clean();
    creds[2] = cred("food_handling", daysFromAt(EXPIRY_WARN_DAYS));
    expect(run(creds).warnings).toBe(1);
  });

  it("does not warn one day outside the window", () => {
    const creds = clean();
    creds[2] = cred("food_handling", daysFromAt(EXPIRY_WARN_DAYS + 1));
    expect(run(creds).warnings).toBe(0);
  });

  it("treats a credential expiring today as a warning, not a failure", () => {
    const creds = clean();
    creds[2] = cred("food_handling", AT);
    const d = run(creds);
    expect(d.allowed).toBe(true);
    expect(d.warnings).toBe(1);
  });

  it("counts multiple expiring credentials separately", () => {
    const creds = clean();
    creds[1] = cred("site_induction", daysFromAt(5), { claims: { siteId: "s-test" } });
    creds[2] = cred("food_handling", daysFromAt(10));
    const d = run(creds);
    expect(d.allowed).toBe(true);
    expect(d.warnings).toBe(2);
  });

  it("never treats a non-expiring credential as expiring", () => {
    expect(run(clean()).warnings).toBe(0);
  });
});

describe("decide — decision context", () => {
  it("records who was checked, for what, where and when", () => {
    const d = decide({
      person,
      credentials: clean(),
      action: "clock_in",
      site,
      at: AT,
      verifier,
    });
    expect(d.context).toEqual({
      subject: person.did,
      subjectName: person.name,
      action: "clock_in",
      siteId: site.id,
      siteName: site.name,
      at: AT,
    });
  });

  it("is the same call for every action — only the recorded action differs", () => {
    const forRoster = run(clean());
    const forSignOff = decide({
      person,
      credentials: clean(),
      action: "sign_off",
      site,
      at: AT,
      verifier,
    });
    expect(forSignOff.allowed).toBe(forRoster.allowed);
    expect(forSignOff.context.action).toBe("sign_off");
  });

  it("is pure — it does not mutate the credentials it is given", () => {
    const creds = clean();
    const snapshot = JSON.stringify(creds);
    run(creds);
    expect(JSON.stringify(creds)).toBe(snapshot);
  });

  it("allows a site with no requirements", () => {
    const open: Site = { ...site, requires: [] };
    const d = run([], open);
    expect(d.allowed).toBe(true);
    expect(d.reasons).toHaveLength(0);
  });
});

describe("summarise", () => {
  it("describes a clean pass", () => {
    expect(summarise(run(clean()))).toBe("Eligible");
  });

  it("pluralises warnings correctly", () => {
    const one = { ...run(clean()), warnings: 1 };
    const two = { ...run(clean()), warnings: 2 };
    expect(summarise(one)).toBe("Eligible with 1 warning");
    expect(summarise(two)).toBe("Eligible with 2 warnings");
  });

  it("counts unmet requirements when blocked", () => {
    expect(summarise(run([cred("rsa", null)]))).toBe(
      "Blocked — 2 requirements not met",
    );
    expect(summarise(run(clean().slice(0, 2)))).toBe(
      "Blocked — 1 requirement not met",
    );
  });
});
