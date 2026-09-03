# Design — Break Compliance (Hospitality Award cl 16) on live clock-ins

**Date:** 2026-09-02 · **Status:** implemented (`feature/break-compliance`)

---

## 1. What this is

A supervisor board that reads live punches from **Connecteam** and tells the floor,
per person, when a break must be given under the **Hospitality Industry (General)
Award 2020 (MA000009) clause 16** — and what it is costing when it isn't. It is the
first feature in the console that is driven by real time-clock data rather than seed.

The pitch line: *"You already know who's clocked in. Covers tells you who's
about to cost you 50% loading, and proves you sent them on break when you did."*

---

## 2. Decisions taken

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Where the rules live | **`lib/awards/` — a rules pack beside `lib/idara/`** | Folding into the Idara engine would have made the trust layer know about meal breaks. Idara answers "can this person be here"; the awards pack answers "what is owed to them now". Same shape (pure, vertical pack, audit on the way out), different question. |
| Where the engine runs | **In the browser, every second, over raw sessions from `/api/breaks`** | Running it server-side would mean either polling Connecteam every second or serving stale timers. Sessions change every 30 s; entitlements change every second. Ship the pure function to the client and let it tick. |
| Roster vs elapsed | **Roster end time drives the Table 2 bracket when linked; elapsed otherwise** | Elapsed-only is reactive: the board can't say "rest due at 15:30" until 15:30. Roster-linked punches make it predictive. Unlinked punches still escalate correctly as hours accrue. |
| "Spread evenly" (16.3) | **Midpoint of each work block either side of the meal** | The award gives no formula. A fixed offset (e.g. +4h) looks precise and is wrong for a 10h shift with a late meal. Midpoints are defensible and easy to swap per venue. |
| What gets audited | **Supervisor actions (`break.decision`), not every tick** | Auditing "overdue" every minute is noise nobody can verify against. "Sent Darie on meal break at 13:56, 20 min overdue, $5.24 loading" is the receipt payroll and Fair Work actually want. |
| Screen placement | **New `/breaks` route under Time & Attendance** | Bolting onto `/attendance` would have buried the timeline and the penalty exposure under the variance table. Break compliance is its own daily ritual for a duty manager. |

---

## 3. The rules encoded (`lib/awards/higa.ts`)

Consolidated award text to 27 Aug 2024.

| Shift length (Table 2) | Meal | Paid rest |
|---|---|---|
| >5h–6h | elective, ≤30 min, employee requests in writing (16.4) | — |
| >6h–8h | ≥30 min unpaid, **after 2h, started within 6h** | — |
| >8h–10h | same | 1 × 20 min (or 2 × 10) |
| >10h | same | 2 × 20 min |

- **16.5 / 16.6** — no meal by the 6h mark on a >6h shift ⇒ +50% ordinary hourly rate
  from 6h until the break is given or the shift ends. Shown accruing live; $ when a rate is known.
- **16.7(a)** — >5h continuous after the unpaid meal ⇒ additional 20 min paid rest.
- **11.2 / 11.4** — casual 12h/shift cap.
- **29.3(c)** — the cl 16 penalty stacks on penalty rates (surfaced as copy, not computed).

Not modelled: 16.7(b) overtime rest, split shifts (15.1(c)(v)), junior 10h cap (13.3),
enterprise agreements, Restaurant Award (MA000119) variants.

---

## 4. Connecteam contract (`lib/integrations/connecteam.ts`)

- `GET /time-clock/v1/time-clocks/{id}/time-activities` — open shift = `end: null`
- `GET /time-clock/v1/time-clocks/{id}/manual-breaks` — break types; **meal vs rest is
  classified by `isPaid`**. Under cl 16 the meal break is the unpaid one and rest breaks are
  paid, and the API returns `isPaid` and `duration` on every type. Name and duration remain
  as fallbacks for a clock that omits the flag.

  **Corrected 2026-09-03, against the live account.** This originally classified by name and
  required venues to name their breaks accordingly. Discovery against real data showed why
  that fails: the account's configured types are `Break` (unpaid, 30 min) and `Rest Break`
  (paid, 20 min). "Break" matches none of `meal|lunch|dinner|unpaid`, so the meal break was
  read as a rest break — cl 16.2 never satisfied, 50% loading accruing from the 6h mark for
  the whole shift, and the weekly report billing for breaks that had been taken. Pinned by
  `tests/break-kinds.test.ts` using the account's actual types.
- `GET /users/v1/users` — names, employment type
- `GET /scheduler/v1/schedulers/{sid}/shifts/{id}` — rostered end (optional)
- Time Clock API is a **paid Connecteam add-on** ("Operations API"). Check before quoting.
- Env: `CONNECTEAM_API_KEY`, `CONNECTEAM_TIME_CLOCK_ID`, `CONNECTEAM_SCHEDULER_ID`,
  `CONNECTEAM_SITE_NAME`, `TZ_VENUE`, `CONNECTEAM_POLL_SECONDS`. Absent → demo seed.

---

## 5. Production path

1. Replace polling with the `time_activity` webhook → Postgres; re-assess on event + 1-min cron.
2. Persist assessments per shift → weekly **missed-break loading report** for payroll.
3. Push "due in 15" nudges to the employee via Connecteam chat; supervisor escalation at overdue.
4. Ordinary hourly rate from `GET /pay-rates/v1/pay-rates` (currently null in live mode).
5. Restaurant Award pack (`lib/awards/ria.ts`) for the second client.

> Not legal advice. Verify against current award text and any EBA before relying on penalty figures.
