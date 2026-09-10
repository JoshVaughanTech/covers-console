/* ============================================================
   A refused publish leaves a receipt, and the receipt is kept.

   recordPublish() used to build its events inside a setAuditLog()
   updater and append them with appendEvent() — into the React
   replica, never to the server — underneath a modal telling the
   operator "This attempt has been written to the audit log." The
   events existed in one browser tab until it was reloaded.

   Two halves to guard, because they fail differently:

   1. The receipt's SHAPE and ORDER, tested directly against
      publishEvents(), which is why that function was lifted out
      of the provider.

   2. That nothing in the provider appends locally again. A test
      cannot easily mount the provider here — there is no DOM
      harness in this suite — but the bug had one signature that
      is checkable in the source: an appendEvent() call somewhere
      other than the single fallback path. That is the shape of
      the mistake, not the instance of it, which is what the
      audit-events check is for too.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publishEvents, blockedSummary, type PublishResult } from "../lib/idara/publish";
import type { Decision } from "../lib/idara/types";

/* ---------- a result to publish ---------- */

const decision = (name: string, slug: string, allowed: boolean): Decision =>
  ({
    allowed,
    warnings: 0,
    reasons: [
      { requirement: "rsa", outcome: allowed ? "pass" : "fail", detail: `RSA: ${allowed ? "held" : "Expired 2023-11-01"}` },
      { requirement: "site_induction", outcome: "pass", detail: "Induction held" },
    ],
    context: {
      subject: `did:web:idara.app:w:${slug}`,
      subjectName: name,
      siteId: "s-brightwater",
    },
  }) as unknown as Decision;

const result = (over: Partial<PublishResult> = {}): PublishResult => {
  const eligible = [decision("Sophie Nguyen", "sophie-nguyen", true)];
  const blocked = [
    decision("Jake Morrison", "jake-morrison", false),
    decision("Michael Tan", "michael-tan", false),
  ];
  return {
    decisions: [...eligible, ...blocked],
    eligible,
    blocked,
    warnings: [],
    coverage: [],
    uncovered: [],
    published: false,
    ...over,
  };
};

describe("what a blocked publish writes", () => {
  it("writes one decision per blocked person, then the attempt", () => {
    const evs = publishEvents("Brightwater Hotel", "s-brightwater", result(), "Emma Taylor", "2026-05-16");
    expect(evs).toHaveLength(3);
    expect(evs.map((e) => e.type)).toEqual(["decision", "decision", "roster.published"]);
  });

  it("puts the summary LAST, so a dropped append never leaves a claim with no reasons", () => {
    /* The order is the contract. A reader finding "blocked — 2 ineligible" with
       the two decisions missing could not tell which two, and would have no way
       to know the record was incomplete. */
    const evs = publishEvents("Brightwater Hotel", "s-brightwater", result(), "Emma Taylor", "2026-05-16");
    expect(evs.at(-1)?.type).toBe("roster.published");
    expect(evs.at(-1)?.data?.published).toBe(false);
  });

  it("names the blocked person in the event about them", () => {
    const evs = publishEvents("Brightwater Hotel", "s-brightwater", result(), "Emma Taylor", "2026-05-16");
    expect(evs[0].summary).toContain("Jake Morrison");
    expect(evs[0].subject).toBe("did:web:idara.app:w:jake-morrison");
    expect(evs[1].summary).toContain("Michael Tan");
  });

  it("keeps only the reasons that failed — a pass is not why somebody was refused", () => {
    const evs = publishEvents("Brightwater Hotel", "s-brightwater", result(), "Emma Taylor", "2026-05-16");
    const reasons = evs[0].data?.reasons as { outcome: string }[];
    expect(reasons).toHaveLength(1);
    expect(reasons.every((r) => r.outcome === "fail")).toBe(true);
  });

  it("carries the same actor and date on every event of one attempt", () => {
    const evs = publishEvents("Brightwater Hotel", "s-brightwater", result(), "Emma Taylor", "2026-05-16");
    expect(evs.every((e) => e.actor === "Emma Taylor")).toBe(true);
    expect(evs.every((e) => e.at === "2026-05-16")).toBe(true);
  });
});

describe("what a clean publish writes", () => {
  it("is one event, because there are no refusals to itemise", () => {
    const evs = publishEvents(
      "Brightwater Hotel",
      "s-brightwater",
      result({ blocked: [], published: true }),
      "Emma Taylor",
      "2026-05-16",
    );
    expect(evs).toHaveLength(1);
    expect(evs[0].type).toBe("roster.published");
    expect(evs[0].data?.published).toBe(true);
    expect(evs[0].data?.eligible).toBe(1);
  });
});

describe("saying which kind of block it was", () => {
  it("counts ineligible people", () => {
    expect(blockedSummary("Brightwater Hotel", result())).toContain("2 ineligible staff members");
  });

  it("says one member, singular, for one", () => {
    const r = result({ blocked: [decision("Jake Morrison", "jake-morrison", false)] });
    expect(blockedSummary("Brightwater Hotel", r)).toContain("1 ineligible staff member");
    expect(blockedSummary("Brightwater Hotel", r)).not.toContain("members");
  });

  it("names a collective gap, which removing people cannot fix", () => {
    const r = result({
      blocked: [],
      uncovered: [{ type: "food_safety_supervisor" } as PublishResult["uncovered"][number]],
    });
    expect(blockedSummary("Brightwater Hotel", r)).toContain("on shift");
  });
});

/* ---------- the provider keeps one appending path ---------- */

describe("the provider does not append locally behind the server's back", () => {
  const provider = readFileSync(join("lib", "idara", "provider.tsx"), "utf8");

  it("calls appendEvent exactly once — the no-backend fallback", () => {
    /* Every other append has to go through the POST, because the server holds
       the lock that decides seq and prevHash. A second appendEvent() in this
       file is the bug this test exists for: an event on screen that no chain
       contains. */
    const calls = provider.match(/appendEvent\(/g) ?? [];
    expect(
      calls.length,
      "appendEvent() belongs only in the offline fallback inside append(). " +
        "Another call means something is writing to the React replica instead of " +
        "the chain — see lib/idara/publish.ts for what that cost last time.",
    ).toBe(1);
  });

  it("posts no event from inside a setCredentials updater", () => {
    /* A state updater is a function React is free to call more than once —
       StrictMode does exactly that in development to surface impure ones. A
       fetch inside one is therefore a request that may be sent twice, and
       since each carries a freshly minted clientRef, the idempotency key
       cannot collapse the pair. revokeCredential() read the list inside the
       updater purely to find the credential, which it can do outside it. */
    expect(
      provider,
      "setCredentials must take a single expression. A block body is where a " +
        "side effect gets hidden — see revokeCredential().",
    ).not.toMatch(/setCredentials\(\([\w\s,]*\) => \{/);
  });

  it("still has the POST that makes an append durable", () => {
    // guards the two checks above: a file that stopped appending at all would
    // pass both and record nothing
    expect(provider).toContain('fetch("/api/events"');
    expect(provider).toContain("clientRef");
  });
});
