# Design — Rename FairShift → Covers

**Date:** 2026-09-02 · **Status:** implemented

## Why

"FairShift" sat in the most crowded corner of the AU workforce market (Deputy, Tanda,
Rostr, Humanforce all own *-shift/-roster* ground) and said nothing a hospitality
buyer would recognise as theirs.

**Covers** is hospo's own unit of throughput ("we did 340 covers") and carries the
compliance meaning for free: shifts covered, credentials covered, breaks covered —
*you're covered*. Plural on purpose: singular "Cover" has an existing US event-catering
product and drifts toward insurance.

Tagline: **Every cover, covered.** Idara stays as the trust layer — "powered by idara".

## Decisions

| Decision | Chosen | Rejected |
|---|---|---|
| Name | **Covers** | *Covered* (better product name, worse hospitality name — insurance drift); *Sidework* (Sideworks.ai is a direct competitor); *Mise* (four restaurant-software companies already); *Onfloor / Brigade / Duty* (good, less hospo-native) |
| Wordmark | lowercase `covers`, Plus Jakarta Sans 800, −4.5% tracking | Title-case; reads as a generic noun rather than a brand |
| Mark | Navy disc, teal open ring, white tick — a plate from above, ticked | Dashed progress ring (mush at 16 px) |
| Ring colour | Doubles as **state**: teal clear · amber due · red overdue · blue on break | Static mark |
| CSS tokens | `--fs-*` / `.fs-*` / `fs-nav-item` **left as-is** | Renaming ~60 token references is churn with no user-visible benefit; treat `fs` as an internal prefix |

## What changed

- `public/assets/` — `fairshift-*.png` removed; `covers-icon`, `covers-icon-t`, `covers-logo`,
  `covers-logo-white`, `covers-lockup-poweredby`, `covers-idara-lockup` (PNG @3x + SVG for the two icons).
- Sidebar wordmark, `<title>`, favicon, package name, comment headers, docs.
- `lib/store/shell.tsx` localStorage keys `fairshift.*` → `covers.*` (persisted company pick resets once).

## Still to do outside the repo

- Domain: check `covers.au` → `covers.com.au` → `getcovers.com` in that order.
- IP Australia trademark search, classes 9 and 42.
- Rename the GitHub repo to `covers-console`.
