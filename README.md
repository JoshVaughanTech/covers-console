# FairShift Console

The desktop **workforce operations** web app for **FairShift** — *powered by idara* (identity &
credential verification). Built from the FairShift design system handoff as a real
**Next.js 15 + TypeScript + Tailwind v4** application (the handoff prototypes were React-via-Babel
references; this is the production recreation).

Built for **hospitality**: multi-venue pub and hotel groups, and the off-premise
catering they run alongside. Venues and events are the same thing to the engine —
a place with its own eligibility rules — so a bar shift and a wedding marquee are
checked by the same call.

> One platform. Every workforce need. — connecting **roster → attendance → labour cost → functions →
> communications** with verified identity baked in.

## Stack

- **Next.js 15** (App Router) + **React 19**
- **TypeScript** (strict)
- **Tailwind CSS v4** (tokens exposed via `@theme` in `app/globals.css`)
- **lucide-react** for line icons
- **next/font** — Plus Jakarta Sans (display/UI/body) + JetBrains Mono (IDs, timers, codes)

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000  → redirects to /overview
npm run build    # production build
npm test         # Idara Core test suite (vitest)
```

## Routes (console modules)

| Route | Screen |
|---|---|
| `/overview` | Operations dashboard (fairness, live attendance, heatmap, activity) |
| `/schedule` | AI-powered rostering (shift grid, AI preview, **Idara publish gate**) |
| `/jobs` | Functions & Events (venue functions + off-premise catering engagements) |
| `/attendance` | Time & Attendance (live status, variance table, function profitability) |
| `/projects` | Run Sheets (event task board, timeline, verified sign-off) |
| `/people` | People (staff directory, credentials-at-a-glance, profiles) |
| `/comms` | Communications (function rooms, chat, acknowledgements) |
| `/credentials` | Credentials & Eligibility — *Idara Verify* (RSA, RSG, food safety) |
| `/audit` | Audit Log — hash-chained decision trail *(Idara)* |
| `/reports` | Reports (labour cost, fairness, compliance) |
| `/settings` | Settings (org, venues, credential rules, notifications) |

`/` redirects to `/overview`.

## Project structure

```
app/
  globals.css            # design tokens (@theme + :root) + type/chrome styles
  layout.tsx             # root: fonts (next/font), <html>/<body>
  page.tsx               # redirect → /overview
  (console)/
    layout.tsx           # app shell: Sidebar + Topbar + IdaraProvider + workspace
    overview/ schedule/ jobs/ attendance/ projects/ people/
    comms/ credentials/ audit/ reports/ settings/                   # screens
components/
  ui/                    # Icon, Button, Badge, Card, Avatar, Ring, Bar, Spark, MetricCard,
                         # Modal, Confirm, Toast, Tabs, Menu, Field, Switch, Pagination, …
  chrome/                # Sidebar, Topbar, nav model
  screen/                # PageHead, CardHead, LinkBtn, Placeholder
lib/
  status.ts              # STATUS tone map (success/warning/danger/info/teal/neutral)
  idara/                 # Idara Core — the trust layer (see below)
  store/shell.tsx        # app-shell context: company, notifications, global search
  data/search.ts         # static search index
tests/                   # vitest suite over Idara Core
docs/                    # identity architecture + the Experiment 1 mandate test
public/assets/           # FairShift + idara logos & marks
```

## Idara Core (`lib/idara/`)

The trust layer underneath every module. Screens never make eligibility calls
themselves — they ask the engine, and consequential answers land in the audit log.

| File | Role |
|---|---|
| `types.ts` | Domain model: `Identity`, `Credential`, `Site`, `Decision`, `AuditEvent`. Vertical-agnostic. |
| `engine.ts` | **`decide()`** → allow/deny + reasons for one person, and **`decideRoster()`** for what the shift owes collectively. Pure and synchronous. |
| `verifier.ts` | The `CredentialVerifier` seam — the single place "is this credential real and current?" is answered. |
| `audit.ts` | Append-only, SHA-256 hash-chained log; `verifyChain()` reports the first broken link. |
| `hash.ts` | SHA-256 + canonical (key-sorted) JSON, so hashes survive a serialisation round-trip. |
| `hospitality.ts` | The hospitality credential taxonomy + the role → duty map. Swapping verticals = swapping this file. |
| `seed.ts` | Demo dataset — deliberately mixed: eligible, expiring, and blocked staff. |
| `provider.tsx` | React binding: `useIdara()`, the publish gate (individual + roster coverage), credential revocation. |

Roster eligibility, verified clock-in, function-room access and verified sign-off are all
the same `decide()` call with a different `action`.

**Requirements bind to duties, not job titles.** A `CredentialRequirement` can carry
`appliesTo: WorkFunction[]` — `serve_alcohol`, `handle_food`, `gaming`, `supervise` — so
RSA is owed by whoever pours and not by the kitchen. Titles drift between venues
("Bartender" / "Bar Attendant") while the duty that triggers a legal obligation doesn't,
so `ROLE_FUNCTIONS` maps titles to duties inside the vertical pack and the engine stays
ignorant of bars and kitchens. Two rules make it safe to rely on:

- **Unknown titles fail safe** — a role the pack doesn't recognise is treated as doing
  everything, so it can only ever be over-checked, never under-checked.
- **Skipped requirements are recorded**, not dropped: `CheckOutcome` includes `"n/a"`, so
  the trail says *"RSA not required for Head Chef"* rather than falling silent.

Where a location *implies* the duty, the location scopes it instead — RSG is unscoped at
the gaming room, because being rostered there is the gaming duty whatever your title.

**And a job title is only the fallback.** `DecideInput.duties` carries what someone is
actually rostered to do, and where the roster knows the assignment it wins:
`input.duties ?? functionsForRole(person.role)`. Put a bartender on the gaming floor and
they owe an RSG whatever their title says. The assignment *replaces* the title rather than
adding to it — a chef put on the bar owes RSA, not food handling, for that shift — and an
explicit `duties: []` is honoured, which is distinct from the fail-safe for unknown titles.

**Some obligations belong to the shift, not the person.** A venue must have a nominated
Food Safety Supervisor on; it does not need every kitchen hand to hold the ticket.
`Site.requiresOnRoster` carries those, and `decideRoster()` checks them — mapping
`decide()` over the roster first, then evaluating coverage, so the per-person primitive
is untouched. **Only eligible people count as holders**: a supervisor whose own induction
has lapsed isn't going to be on shift, so they can't discharge the venue's obligation
either.

The consequence is a second kind of block — a roster where **nobody is individually at
fault and the shift is still illegal**. The gate says so plainly, and withdraws the
"publish the verified subset" action, because dropping people can never satisfy a
collective requirement.

**The publish gate** is the load-bearing demo: `/schedule` → *Publish Roster* runs the
engine over every rostered staff member, and a roster containing someone non-compliant
**cannot be published**. The blocked attempt is itself written to the audit log, with a
per-person receipt naming the failed requirement — visible at `/audit`.

In the seeded week that means three blocks for three different reasons: an **expired
RSA**, a **missing venue induction**, and an **RSA revoked by the regulator** — plus a
bartender cleared for the floor but not the **gaming room**, because RSG is licensed
separately. A functions coordinator clears the venue *and* both catering operations on
one RSA and three separate inductions — the portability argument in miniature. The head
chef holds no RSA at all and is still eligible, because the licence never bound to the
kitchen. And a bartender rostered onto the gaming floor is blocked for RSG while another
bartender, same title but no gaming assignment, is not.

### Tests

`npm test` — 136 tests over the engine, verifier, hash chain, role scoping, roster coverage,
shift assignments and seed dataset.
Notably `tests/demo.test.ts` pins the demo's *narrative*: if a seeded credential date
is edited and a blocked staff member quietly becomes eligible, the suite fails before
the demo does. `tests/hash.test.ts` checks the SHA-256 implementation against published
NIST vectors and against `node:crypto` across the message-padding boundaries.

## Design system

All tokens live in `app/globals.css` as CSS custom properties (ported verbatim from the handoff's
`colors_and_type.css`) and are also surfaced to Tailwind utilities via `@theme inline` — so both the
inline-styled components (`var(--fs-teal)`) and Tailwind classes (`bg-fs-teal`, `text-fg-2`) share one
source of truth.

- **Brand:** one teal accent `--fs-teal #0D8B82` on deep-navy chrome `--ink-900`, cool-white surfaces.
- **Type:** Plus Jakarta Sans, heavy tight headings, tabular numerals (`.fs-tnum`) in tables/metrics.
- **Status:** small dot/icon + tinted pill — never large fills.
- **idara:** verification layer — green check + "Verified by idara".

## Notes & substitutions (from the handoff)

- **Font** Plus Jakarta Sans is the nearest match — swap if a real brand font surfaces.
- **Icons** Lucide stand in for the real set.
- **Avatars** are initials-on-tint placeholders — swap for real staff photos.
- **Logos** were cropped from raster artwork — request SVG originals for production.
- Screen data is **mock/seed data** lifted from the reference designs. Wire to real APIs
  (auth, scheduling, time-tracking, messaging, idara verification) for production.

## Where this sits in the plan

Two documents in `docs/` set the direction, and they gate each other:

- **[`experiment-1-mandate-test.md`](docs/experiment-1-mandate-test.md)** — the next move.
  8 discovery conversations testing whether a hospitality operator — a pub group, a
  caterer, or a staffing agency — will *mandate* Idara and pay per head. It costs ~2–3
  weeks and **zero new code**: it runs on the Schedule + Audit demo already in this
  repo, and carries a pre-committed GREEN/YELLOW/RED decision rule.
- **[`idara-identity-architecture.md`](docs/idara-identity-architecture.md)** — the SSI
  network this console is the first relying party for. Phase 1 (AA wallet, `did:web`
  issuer, SD-JWT VCs, "Sign in with Idara") is **gated behind that test passing.**

The key architectural claim: the eligibility brain in `lib/idara/` doesn't change when
the network arrives — only the source of truth under it does, from "a record we hold" to
"a cryptographically verified, user-consented presentation." `CredentialVerifier` is the
seam where that swap happens; `tests/verifier.test.ts` pins the contract it must honour.
