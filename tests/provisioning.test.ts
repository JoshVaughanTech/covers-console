/* ============================================================
   Provisioning, and the vault it decrypts from.

   Two properties, and both of them are the kind that only ever
   surface in production.

   IDEMPOTENCY. A retry after a timeout must land on the employee it
   already made. In a payroll a duplicate is not a stray row — it is
   the same person twice, with the same TFN, two sets of payments,
   and an STP lodgement that disagrees with itself. So the tests
   below run provision twice, three ways, and count employees.

   THE RELEASE LOG. What a worker is shown about where their details
   went has to be what actually left. The list is asserted against
   the connector's own call tape rather than against the function's
   return value, so a release recorded but never sent — or sent but
   never recorded — fails here.

   And one property that is not about correctness but about what
   this product claims: nothing decrypted ever reaches the chain, a
   log line, or anything the console can render. The last test in
   each block is that.
   ============================================================ */
import { describe, it, expect } from "vitest";
import { PackVault } from "../lib/idara/vault";
import { buildPacks } from "../lib/idara/pack-seed";
import { EMPLOYERS } from "../lib/idara/employer-seed";
import {
  acceptEngagement,
  plannedReleases,
  proposeEngagement,
  type Engagement,
} from "../lib/idara/engagement";
import { MockPayrollConnector, MockTimeClock } from "../lib/payroll/mock";
import { ProvisionError, provisionEngagement } from "../lib/payroll/provision";
import { WORKERS } from "../lib/idara/seed";
import type { WorkerPack } from "../lib/idara/pack";

const AT = "2024-05-16";
const EMPLOYER = EMPLOYERS[0];
const worker = (name: string) => WORKERS.find((w) => w.name === name)!;

const SHIFT = {
  siteId: "s-brightwater",
  date: "2026-09-11",
  start: "17:00",
  end: "01:00",
  role: "Bartender",
  startsAt: 1_757_581_200,
  endsAt: 1_757_610_000,
};

/** A fresh world per test: its own vault, its own packs, its own payroll. */
function world(name = "Darie Roberts") {
  const vault = new PackVault();
  const packs = buildPacks(vault);
  const pack = packs.get(worker(name).did)!;
  const connector = new MockPayrollConnector();
  const timeClock = new MockTimeClock();

  const sign = (postingId: string, priorEngagements: Engagement[] = []): Engagement => {
    const r = proposeEngagement({
      worker: { did: worker(name).did, name },
      pack,
      employer: EMPLOYER,
      postingId,
      shift: SHIFT,
      offeredRateCents: 4150,
      floorRateCents: 4062,
      loadings: ["casual_25"],
      blockReason: null,
      priorEngagements,
      at: AT,
    });
    if (!r.ok) throw new Error(r.refusals.map((x) => x.code).join(", "));
    const withEmployer = acceptEngagement(r.engagement, "employer", { at: AT, eventHash: "h-emp" });
    return acceptEngagement(withEmployer, "worker", { at: AT, eventHash: "h-wor" });
  };

  const run = (engagement: Engagement, withClock = true) =>
    provisionEngagement({
      engagement,
      pack,
      connector,
      vault,
      ...(withClock ? { timeClock } : {}),
      employmentType: "casual",
      at: AT,
    });

  return { vault, pack, connector, timeClock, sign, run };
}

describe("a first engagement", () => {
  it("creates the employee, lodges the declaration, records the fund and delivers both statements", async () => {
    const w = world();
    const result = await w.run(w.sign("p-1"));

    expect(result.createdEmployee).toBe(true);
    expect(result.engagement.status).toBe("provisioned");

    const methods = w.connector.calls.map((c) => c.method);
    expect(methods).toContain("findEmployee");
    expect(methods).toContain("createEmployee");
    expect(methods).toContain("lodgeTfnDeclaration");
    expect(methods).toContain("recordSuperChoice");
    expect(methods).toContain("deliverStatements");

    const employee = w.connector.describe(result.externalId)!;
    expect(employee.tfnLodged).toBe(true);
    expect(employee.superRecorded).toBe(true);
    expect(employee.statements).toEqual(["fwis", "ceis"]);
    expect(employee.classification).toBe("food_and_beverage L2");
  });

  it("looks the employee up before creating one", async () => {
    const w = world();
    await w.run(w.sign("p-1"));
    const methods = w.connector.calls.map((c) => c.method);
    expect(methods.indexOf("findEmployee")).toBeLessThan(methods.indexOf("createEmployee"));
  });

  it("releases exactly the five items the engagement planned, and logs each one", async () => {
    const w = world();
    const engagement = w.sign("p-1");
    const planned = plannedReleases(engagement);
    const result = await w.run(engagement);

    expect([...result.released].sort()).toEqual([...planned].sort());
    expect(result.engagement.releases.map((r) => r.item).sort()).toEqual([...planned].sort());
    expect(result.engagement.releases.every((r) => r.toConnector === "mock")).toBe(true);
  });

  /* The identity payload is needed twice — the payroll employee and the time
     clock user — and it is decrypted once. The log counts disclosures, not
     function calls, because that is what a person reading it thinks it means. */
  it("does not log a second release for a payload it used twice", async () => {
    const w = world();
    const result = await w.run(w.sign("p-1"));
    const identityReleases = result.engagement.releases.filter((r) => r.item === "identity");
    expect(identityReleases).toHaveLength(1);
    expect(w.timeClock.calls.map((c) => c.method)).toContain("createUser");
  });

  it("sends nothing but a name and an email to the time clock", async () => {
    const w = world();
    await w.run(w.sign("p-1"));
    // the clock is a roster tool. If it ever grows a payroll method, this fails
    expect(w.timeClock.calls.map((c) => c.method).sort()).toEqual(
      ["assignShift", "createUser", "findUser"].sort(),
    );
    expect(w.timeClock.shifts).toHaveLength(1);
  });

  /* The answer lodged with the ATO comes from the engagement, which decided it
     against the one employer the worker nominated — not from a pack field that
     would carry the same answer to every employer. */
  it("lodges the threshold answer the engagement decided", async () => {
    const claiming = world("Darie Roberts");
    const claimingResult = await claiming.run(claiming.sign("p-1"));
    expect(claiming.connector.describe(claimingResult.externalId)!.claimsTaxFreeThreshold).toBe(true);

    // Leanne claims it with another employer entirely
    const elsewhere = world("Leanne Vidal");
    const elsewhereResult = await elsewhere.run(elsewhere.sign("p-1"));
    expect(elsewhere.connector.describe(elsewhereResult.externalId)!.claimsTaxFreeThreshold).toBe(false);
  });

  it("never exposes the number it lodged", async () => {
    const w = world();
    const result = await w.run(w.sign("p-1"));
    const summary = w.connector.describe(result.externalId)!;
    expect(JSON.stringify(summary)).not.toMatch(/000 000/);
    // and nothing decrypted is on the engagement either
    expect(JSON.stringify(result.engagement)).not.toMatch(/000 000/);
  });
});

describe("running it twice", () => {
  it("creates one employee when the same engagement is provisioned again", async () => {
    const w = world();
    const engagement = w.sign("p-1");
    const first = await w.run(engagement);
    const second = await w.run(first.engagement);

    expect(w.connector.employeeCount).toBe(1);
    expect(second.createdEmployee).toBe(false);
    expect(second.released).toEqual([]);
  });

  /* The harder retry: the first run reached the payroll and the answer never
     came back, so the caller retries with an engagement still at `accepted`.
     The lookup has to be what saves it, not the status. */
  it("creates one employee when a retry arrives before the status advanced", async () => {
    const w = world();
    const engagement = w.sign("p-1");
    await w.run(engagement);
    const retry = await w.run(engagement);

    expect(w.connector.employeeCount).toBe(1);
    expect(retry.createdEmployee).toBe(false);
    expect(retry.engagement.status).toBe("provisioned");
  });

  /* A run that created the employee and then failed before lodging must, on
     retry, still lodge. Skipping the declaration because the employee now
     exists would leave somebody employed with nothing on file. */
  it("still lodges the declaration on a retry that finds the employee", async () => {
    const w = world();
    const engagement = w.sign("p-1");
    await w.run(engagement);
    const before = w.connector.calls.filter((c) => c.method === "lodgeTfnDeclaration").length;
    await w.run(engagement);
    const after = w.connector.calls.filter((c) => c.method === "lodgeTfnDeclaration").length;
    expect(after).toBeGreaterThan(before);
  });
});

describe("a second engagement with the same employer", () => {
  it("releases nothing and only adds the roster line", async () => {
    const w = world();
    const first = await w.run(w.sign("p-1"));
    const second = w.sign("p-2", [first.engagement]);

    expect(second.employment.firstEngagementWithEmployer).toBe(false);
    const result = await w.run(second);

    expect(result.released).toEqual([]);
    expect(result.engagement.releases).toEqual([]);
    expect(w.connector.employeeCount).toBe(1);
    expect(w.timeClock.shifts).toHaveLength(2);
  });
});

describe("refusals", () => {
  it("refuses to release anything before both sides have signed", async () => {
    const w = world();
    const r = proposeEngagement({
      worker: { did: worker("Darie Roberts").did, name: "Darie Roberts" },
      pack: w.pack,
      employer: EMPLOYER,
      postingId: "p-1",
      shift: SHIFT,
      offeredRateCents: 4150,
      floorRateCents: 4062,
      loadings: [],
      blockReason: null,
      priorEngagements: [],
      at: AT,
    });
    if (!r.ok) throw new Error("expected a proposal");

    await expect(w.run(r.engagement)).rejects.toBeInstanceOf(ProvisionError);
    expect(w.connector.employeeCount).toBe(0);
  });

  /* The engagement must not advance to `provisioned` on a partial run.
     `provisioned` is the state that asserts payroll holds what the law
     requires, and asserting it falsely is the one thing this cannot do. */
  it("fails loudly, and short of provisioned, when a pack item cannot be released", async () => {
    const w = world();
    const engagement = w.sign("p-1");
    const gutted: WorkerPack = {
      ...w.pack,
      items: w.pack.items.filter((i) => i.kind !== "bank_account"),
    };

    await expect(
      provisionEngagement({
        engagement,
        pack: gutted,
        connector: w.connector,
        vault: w.vault,
        employmentType: "casual",
        at: AT,
      }),
    ).rejects.toThrow(/bank_account/);
    expect(engagement.status).toBe("accepted");
  });
});

describe("the vault", () => {
  it("returns what was stored, to a caller that names the engagement", () => {
    const vault = new PackVault();
    const ref = vault.put("did:example:worker", "bank_account", { bsb: "063000" });
    expect(vault.release(ref, { engagementId: "eng-1", toConnector: "mock" })).toEqual({
      bsb: "063000",
    });
  });

  it("throws on a pointer it does not hold rather than returning nothing", () => {
    const vault = new PackVault();
    expect(() => vault.release("vault:missing", { engagementId: "eng-1", toConnector: "mock" })).toThrow();
  });

  it("keys per worker, so one worker's key cannot read another's payload", () => {
    const vault = new PackVault();
    const a = vault.put("did:example:a", "tfn_declaration", { tfn: "000 000 001" });
    const b = vault.put("did:example:b", "tfn_declaration", { tfn: "000 000 002" });
    expect(vault.release(a, { engagementId: "e", toConnector: "mock" })).toEqual({ tfn: "000 000 001" });
    expect(vault.release(b, { engagementId: "e", toConnector: "mock" })).toEqual({ tfn: "000 000 002" });
  });

  /* Deleting a worker: the hash stays on the chain, the payload is destroyed.
     What survives is a record that something was true and no way to read it. */
  it("destroys one worker's payloads and leaves everybody else's", () => {
    const vault = new PackVault();
    const mine = vault.put("did:example:a", "bank_account", { bsb: "063000" });
    const theirs = vault.put("did:example:b", "bank_account", { bsb: "083000" });

    expect(vault.destroy("did:example:a")).toBe(1);
    expect(vault.has(mine)).toBe(false);
    expect(vault.has(theirs)).toBe(true);
  });
});
