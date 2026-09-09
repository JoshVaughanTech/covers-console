import { describe, it, expect } from "vitest";
import { tabsFor } from "../app/m/nav";

/* ============================================================
   Which tabs a phone shows, and to whom.

   The property here is that the two sets do not overlap, and the
   reason is not tidiness. Every screen under /m except /m/post
   reads `b.worker` from the session; an operator holding a venue
   sign-in has none, so those screens render the STAFF SIGN-IN
   PICKER. Showing an operator a worker tab therefore does not
   waste a tap — it invites them to sign in as a worker, which
   replaces the operator session they are holding, after which the
   Post tab disappears and nothing explains why.

   Operators and workers are separate populations on purpose
   (lib/auth/operators.ts: "an operator is not a worker with a
   flag"), and Sophie Nguyen exists in both rosters — so the
   identity a nav can talk somebody into swapping is a real one
   they also hold.

   Held here rather than in a rendering test because the decision
   is data. There is no DOM in this repo's test setup and this
   needs none.
   ============================================================ */

const hrefs = (kind: "worker" | "operator" | null) => tabsFor(kind).map((t) => t.href);

describe("the two navs do not overlap", () => {
  it("gives an operator no screen that would ask them to sign in as staff", () => {
    const operator = hrefs("operator");
    for (const worker of hrefs("worker")) {
      expect(operator, `${worker} is offered to an operator`).not.toContain(worker);
    }
  });

  it("gives a worker nothing that would 401", () => {
    // POST /api/shifts/post is operators-only and refuses a worker session
    expect(hrefs("worker")).not.toContain("/m/post");
  });

  it("shares no href in either direction", () => {
    const both = hrefs("worker").filter((h) => hrefs("operator").includes(h));
    expect(both, `shared: ${both.join(", ")}`).toHaveLength(0);
  });
});

describe("what each kind gets", () => {
  it("gives a signed-out phone the worker tabs", () => {
    /* The phone app is for staff; the venue screens are the exception. A
       signed-out visitor is far likelier to be a worker, and the sign-in they
       land on is the one they want. */
    expect(hrefs(null)).toEqual(hrefs("worker"));
  });

  it("keeps every worker tab inside /m", () => {
    for (const h of hrefs("worker")) expect(h.startsWith("/m")).toBe(true);
  });

  it("gives an operator somewhere to go besides posting", () => {
    /* A nav with one item has stopped being a nav. The console is where the
       rest of an operator's work lives, and the phone should not be a
       cul-de-sac. */
    expect(hrefs("operator").length).toBeGreaterThan(1);
    expect(hrefs("operator").some((h) => !h.startsWith("/m"))).toBe(true);
  });

  it("lets an operator post", () => {
    expect(hrefs("operator")).toContain("/m/post");
  });

  it("labels every tab", () => {
    // a tab with no label is a tab nobody can aim at
    for (const kind of ["worker", "operator"] as const) {
      for (const t of tabsFor(kind)) expect(t.label.trim().length).toBeGreaterThan(0);
    }
  });
});
