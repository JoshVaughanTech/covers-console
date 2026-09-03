# Design — Events rename, and the venue/catering operating mode

**Date:** 2026-09-03 · **Status:** designed, awaiting implementation

Two changes that belong in one pass because they touch the same screens: renaming
the Functions concept to Events (route included), and giving `Site` a `kind` so the
schedule can behave differently for a catering operation than for a fixed venue.

---

## 1. "Functions" means three different things

A grep for `Functions` returns 24 hits across 11 files. They are not one concept, and
replacing them wholesale would break the trust engine.

| Meaning | Where | Rename? |
|---|---|---|
| **The product concept** — the screen, the route, the nav entry | `nav.ts`, `jobs/page.tsx`, `overview/page.tsx` | **Yes.** This is what the note asks for. |
| **Job titles** — "Functions Coordinator", "Functions Manager", "Functions Team" | `people`, `attendance`, `projects`, `search`, `awards/seed`, `idara/seed`, `hospitality.ts` | **Yes, but carefully** — see below. |
| **`WorkFunction`** — the Idara duty type (`serve_alcohol`, `gaming`, `handle_food`) | `lib/idara/*`, `schedule/page.tsx` | **No. Never.** |

`WorkFunction` means "a duty a person performs", and has nothing to do with events. It
is the vocabulary the eligibility engine is built on — `duties?: WorkFunction[]`,
`functionsForRole()`, the whole per-shift assignment model. Renaming it would be a
large, silent, wrong change. It is called out here because "change functions to events"
sounds like a find-and-replace and must not be one.

The job titles are the subtle case. `hospitality.ts` maps role names to duties with the
role string as the **key**:

```ts
"Functions Coordinator": ["serve_alcohol", "handle_food", "supervise"],
```

Renaming the title means renaming that key and every seed record that references it, in
lockstep, or Priya Sharma silently loses her duty mapping and with it her eligibility.
Doable, but it is a data migration wearing a rename's clothes, and it must be done as
one atomic change with the tests green either side.

---

## 2. Decisions taken

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Route | **`/jobs` → `/events`** | The route already said `jobs` while the label said "Functions" — two names for one thing, neither of them the new one. Renaming the label alone would leave the mismatch and add a third. |
| Interface name | **`Job` → `EventBooking`** | `interface Event` would shadow the DOM's global `Event` type in a `.tsx` file. `EventBooking` keeps the domain word without the collision, and reads correctly: the row is a booking, not the occasion itself. |
| Operating mode | **`Site.kind: "venue" \| "catering"`, org behaviour derived** | An org-level setting would contradict the data the moment an operator runs both — which the demo org already does, with four venues and two catering operations. Deriving org behaviour from the sites means one source of truth that cannot disagree with itself. |
| Catering schedule | **Same Mon–Sun frame, events as the unit** | A caterer has no standing week to grid, but still thinks in weeks. Keeping the frame and swapping row-per-role for block-per-event preserves the mental model while changing what fills it. Redirecting to `/events` was rejected as losing the week at a glance. |
| Site selection | **Filter tabs on `/schedule`** | Matches the venue filter already shipped on `/reports/breaks`. A topbar picker would be more coherent long-term but changes global chrome and every screen's assumptions, including two already shipped. |
| `WorkFunction` | **Untouched** | See above. |

---

## 3. `Site.kind`

```ts
export interface Site {
  id: string;
  name: string;
  region: string;
  /** A fixed venue trades on a standing weekly roster; a catering operation
   *  exists only for its events. The schedule reads this to decide its shape. */
  kind: "venue" | "catering";
  requires: CredentialRequirement[];
  requiresOnRoster?: RosterRequirement[];
}
```

The distinction already exists in the seed — in prose. `types.ts` says `Site` "covers
both a fixed venue (a pub, a tavern) and an off-premise catering operation (a wedding, a
corporate lunch)", and the six seeded sites split cleanly four/two. This change promotes
that comment into a field the code can read.

Required, not optional. An optional `kind` would let a site exist in neither mode and
force every consumer to guess a default; six sites is a small enough set to classify
exhaustively, and a compile error on the seventh is the point.

Org behaviour is **derived**, never stored: `sites.every(s => s.kind === "catering")`
means the operator is a caterer, and the standing roster hides itself. No second setting,
so no possibility of the setting and the sites disagreeing.

---

## 4. What changes on `/schedule`

Today the page is hardcoded to `SITE_ID = "s-brightwater"` with no way to choose a site,
and the topbar switcher controls *company*, not site. So the selector is a genuine
addition, not a restyle — it is the mechanism the whole feature hangs on.

**Venue site** — unchanged: the weekly coverage grid (Bar 64h/day, Kitchen 40h/day …),
the AI roster preview, and the Idara publish gate exactly as they are today.

**Catering site** — same week frame, different unit. One row per event in that week, each
block spanning its days, showing crew filled/required and call time. Coverage means "is
this event staffed", not "are we meeting a daily hour requirement", because a caterer has
no daily hour requirement.

The publish gate stays in both modes. Eligibility does not care which kind of site it is —
Idara asks the same question either way, and `Site.requires` already differs per site.

---

## 5. Testing

- `Site.kind` is required, so every existing seed site must be classified — the type
  system enforces exhaustiveness rather than a test.
- Derived org mode: all-catering hides the roster; mixed shows both; all-venue is today's
  behaviour unchanged.
- The credential mapping survives the job-title rename — Priya Sharma keeps her duties
  and her eligibility. This is the test that matters most, because the failure mode is
  silent.
- Route: `/events` serves the page; nothing still links to `/jobs`.
- 183 existing tests stay green; the rename must not change a single eligibility outcome.

---

## 6. Not in this pass

The break-compliance mobile app and the casual shift marketplace, both of which need a
real backend — today the board, the roster and the audit chain all live in browser
memory, so two supervisors on two devices would each see a private reality. That decision
is deliberate and separate.

`Site.kind` is likely to be useful to the marketplace, which is being built in parallel:
a catering company's casual pool almost certainly filters differently from a venue's.
Better to depend on the discriminator than to duplicate it.
