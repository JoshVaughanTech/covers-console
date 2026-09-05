import { describe, it, expect } from "vitest";
import { claimBlockReason, credentialsNow, boardFrom, type ShiftPosting } from "../lib/shifts";
import { LocalCredentialVerifier } from "../lib/idara/verifier";
import { CREDENTIALS, SITES, WORKERS, TODAY } from "../lib/idara/seed";
import { appendEvent } from "../lib/idara/audit";
import type { AuditEvent, Credential, Identity, Site } from "../lib/idara/types";

/* ============================================================
   The gate, which is now the only copy.

   Three callers depend on this answer — the console board, the
   phone list, and the claim endpoint — and the marketplace's whole
   compliance claim is that they cannot disagree. Before this
   existed the logic lived inside a page component, where the phone
   could not reach it, and the only way to give the phone an answer
   would have been to write it twice.
   ============================================================ */

const verifier = new LocalCredentialVerifier();
const who = (name: string): Identity => WORKERS.find((w) => w.name === name)!;
const where = (id: string): Site => SITES.find((s) => s.id === id)!;
const credsFor = (did: string, from: Credential[] = CREDENTIALS) => from.filter((c) => c.subject === did);

/** A posting at a site, with duties, and nothing else load-bearing. */
const posting = (over: Partial<ShiftPosting> = {}): ShiftPosting => ({
  id: "sp-test",
  role: "Bartender",
  seats: 2,
  functionName: "Test Function",
  siteId: "s-brightwater",
  day: "Fri, 17 May",
  window: "17:00–01:00",
  shiftId: "Fri",
  duties: ["serve_alcohol"],
  requires: [],
  claims: [],
  assigned: [],
  status: "open",
  ...over,
});

const gate = (p: ShiftPosting, person: Identity, at = TODAY, creds?: Credential[]) =>
  claimBlockReason({
    posting: p,
    person,
    site: where(p.siteId),
    credentials: creds ?? credsFor(person.did),
    at,
    verifier,
  });

describe("who may take a shift", () => {
  it("allows someone holding what the shift's duties demand", async () => {
    // Darie holds a current RSA and is inducted at Brightwater
    expect(gate(posting(), who("Darie Roberts"))).toBeNull();
  });

  it("refuses with the credential reason, not a generic no", async () => {
    // Michael Tan's RSA is revoked in the seed
    const reason = gate(posting(), who("Michael Tan"));
    expect(reason).not.toBeNull();
    // the phone shows this to the worker, so it has to name the thing to fix
    expect(reason?.toLowerCase()).toMatch(/rsa|licence|license|induction/);
  });

  it("gates on the shift's duties rather than the job title", async () => {
    /* Same person, same site, same day — only what the shift involves differs.
       Michael Tan's RSA is revoked, which matters behind the bar and does not
       matter clearing tables. A gate reading the job title could not tell
       those two shifts apart. */
    const mt = who("Michael Tan");
    expect(gate(posting({ role: "Wait Staff", duties: [] }), mt)).toBeNull();
    expect(gate(posting({ role: "Wait Staff", duties: ["serve_alcohol"] }), mt)).toMatch(/RSA/);
  });

  it("demands RSG of everyone in the gaming room, whatever the duties say", async () => {
    /* Not an exception to the rule above but the other half of it: where the
       location itself implies the duty, the location scopes the requirement.
       Darie is inducted for gaming and holds no RSG. */
    const p = posting({ siteId: "s-brightwater-gaming", duties: ["serve_alcohol"] });
    expect(gate(p, who("Darie Roberts"))).toMatch(/RSG/);
  });
});

describe("the commercial layer, kept apart from the legal one", () => {
  it("refuses an excluded client without calling it a credential problem", async () => {
    // Michael Tan is excluded from Meridian Group in the staff profiles
    const p = posting({ role: "Wait Staff", duties: [], client: "Meridian Group" });
    expect(gate(p, who("Michael Tan"))).toBe("Not available for this client");
    // and the same shift without that client is fine, so it is the exclusion
    // talking and not something about him
    expect(gate(posting({ role: "Wait Staff", duties: [] }), who("Michael Tan"))).toBeNull();
  });

  it("answers the credential question first", async () => {
    /* Michael Tan is both excluded from this client and short an RSA. Behind
       a bar he is refused for the licence, not the preference — the two are
       different kinds of fact and only one of them is a compliance matter. */
    const p = posting({ client: "Meridian Group", duties: ["serve_alcohol"] });
    expect(gate(p, who("Michael Tan"))).toMatch(/RSA/);
  });

  it("does not apply client preference to in-house work", async () => {
    // an in-house posting has no client, so the component correctly never runs
    const p = posting({ client: undefined });
    for (const w of WORKERS) {
      expect(gate(p, w)).not.toBe("Not available for this client");
    }
  });
});

describe("failing closed", () => {
  it("refuses when the person cannot be resolved", async () => {
    expect(
      claimBlockReason({
        posting: posting(),
        person: undefined,
        site: where("s-brightwater"),
        credentials: [],
        at: TODAY,
        verifier,
      }),
    ).toBe("Not eligible");
  });

  it("refuses when the site cannot be resolved", async () => {
    // an unresolvable id must never become an unchecked claim
    expect(
      claimBlockReason({
        posting: posting({ siteId: "s-nowhere" }),
        person: who("Darie Roberts"),
        site: undefined,
        credentials: credsFor(who("Darie Roberts").did),
        at: TODAY,
        verifier,
      }),
    ).toBe("Not eligible");
  });
});

describe("a credential expiring on the day it is checked", () => {
  /* The case 055f9e2 fixed, from the other side. A licence valid THROUGH the
     16th, checked on the 16th, must not read as expired — the worker is
     entitled to work and would otherwise be refused with their own licence
     named as the reason. */
  const darie = who("Darie Roberts");
  const expiringToday: Credential[] = credsFor(darie.did).map((c) =>
    c.type === "rsa" ? { ...c, expiresAt: TODAY } : c,
  );

  it("still allows the claim on a bare date", async () => {
    expect(gate(posting(), darie, TODAY, expiringToday)).toBeNull();
  });

  it("still allows the claim when the caller passes a full timestamp", async () => {
    // the phone writes new Date().toISOString(); a gate that compared raw
    // strings would sort that after the expiry date and refuse
    expect(gate(posting(), darie, `${TODAY}T22:10:00.000Z`, expiringToday)).toBeNull();
  });

  it("refuses the day after, which is the point of an expiry", async () => {
    expect(gate(posting(), darie, "2024-05-17", expiringToday)).not.toBeNull();
  });
});

describe("credentials as the chain leaves them", () => {
  const chain = (evs: Parameters<typeof appendEvent>[1][]): AuditEvent[] =>
    evs.reduce<AuditEvent[]>((log, e) => appendEvent(log, e), []);

  it("returns the seed untouched when nothing was revoked", async () => {
    expect(credentialsNow([])).toBe(CREDENTIALS);
  });

  it("applies a revocation the console recorded", async () => {
    const target = CREDENTIALS.find((c) => c.type === "rsa" && c.status === "valid")!;
    const log = chain([
      {
        type: "credential.revoked",
        at: TODAY,
        actor: "Emma Taylor",
        subject: target.subject,
        summary: "RSA revoked",
        data: { credId: target.id, type: target.type },
      },
    ]);

    const after = credentialsNow(log).find((c) => c.id === target.id)!;
    expect(after.status).toBe("revoked");
    // and the seed itself is not mutated — other readers must be unaffected
    expect(CREDENTIALS.find((c) => c.id === target.id)!.status).toBe("valid");
  });

  it("stops someone claiming once their licence is struck off", async () => {
    const darie = who("Darie Roberts");
    const rsa = credsFor(darie.did).find((c) => c.type === "rsa")!;
    const before = gate(posting(), darie);
    expect(before).toBeNull();

    const log = chain([
      {
        type: "credential.revoked",
        at: TODAY,
        actor: "Emma Taylor",
        subject: darie.did,
        summary: "RSA revoked",
        data: { credId: rsa.id, type: "rsa" },
      },
    ]);

    const board = boardFrom(log);
    const after = gate(posting(), darie, board.at, board.credentials.filter((c) => c.subject === darie.did));
    // the console revoked it; the phone must not still be offering the shift
    expect(after).not.toBeNull();
  });
});

describe("the board the server builds", () => {
  it("carries the console's date, not the wall clock", async () => {
    // the demo world is dated; a gate on the real date would expire everything
    // and read as a broken gate rather than a dated fixture
    expect(boardFrom([]).at).toBe(TODAY);
  });

  it("starts from the seed postings", async () => {
    const board = boardFrom([]);
    expect(board.postings.length).toBeGreaterThan(0);
    expect(board.postings.some((p) => p.status === "draft")).toBe(true);
  });
});
