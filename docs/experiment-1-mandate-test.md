# Experiment 1 — The Mandate Test

> **Purpose:** find out, before building the wallet/ZK/network, whether a real
> hospitality operator — a pub/hotel group, a catering company, or a hospitality
> staffing agency — will **mandate** staff use of Idara and **pay per head** to
> gate rostering on verified credentials.
>
> Adoption in B2B2C has exactly one realistic engine: an employer who *requires*
> it. If no one will mandate it, the whole self-sovereign-identity venture has no
> distribution and should not be built. This test costs ~2–3 weeks and zero new
> code (it uses the existing Schedule + Audit demo).

---

## 1. The hypothesis (falsifiable)

**H1 (primary):** A hospitality operator will *require* its staff to use Idara
and *pay a per-worker recurring fee* to gate rostering on verified credentials.

Supporting sub-hypotheses, each independently testable:
- **H1a — Pain is real, frequent, costly.** Confirming that everyone rostered
  holds a current RSA (and RSG, and food safety tickets) is painful enough to
  spend money/time on, and failures cause a shift being re-covered, a licence
  problem, a fine, or a regulator/council visit.
- **H1b — There is a person with the authority + budget to mandate.** The buyer
  can both *require* the tool and *pay* for it.
- **H1c — Portability is felt.** Casuals re-prove the same RSA at every venue,
  agency and event they work, and someone is annoyed enough to want it fixed.

H1c is the only thing that justifies *decentralisation* over a centralised
incumbent. If H1a/H1b pass but H1c fails, you have a SaaS opportunity, not an
identity-network one.

**Hospitality should test H1c harder than construction did.** Casual churn is
higher and a single person may work several venues in one week — but that is a
hypothesis to test, not a fact to assert in the room.

**This test does NOT validate:** ZK, blockchain, self-sovereignty as features.
Nobody buys those. We're testing the *job*, the *mandate*, and the *money*.

---

## 2. Who to talk to (and who NOT to)

Target **8 conversations**, weighted toward the segments where portability bites:

| Segment | # | Why | Who exactly |
|---|---|---|---|
| Hospitality staffing agencies | 3 | Highest churn; staff span many venues → portability pain | Director / Ops manager |
| Multi-venue pub / hotel groups | 3 | The relying party + the mandate authority; gaming raises the stakes | Group Ops Manager, Licensee |
| Catering companies | 2 | Casuals hired per event, across sites they don't control | Owner / Ops manager |

**Authority filter — non-negotiable:** you must reach someone who can *require*
what staff use. A duty manager or a venue manager at a single site usually
cannot. If your contact can't, your only goal for that call is an intro to the
person who can — for a group, that is typically the licensee or group operations
manager; for an agency, the director.

**Where to find them:** existing network first; then the Australian Hotels
Association, Restaurant & Catering Australia, Clubs Australia, and local
licensing/industry groups; LinkedIn (Group Operations Manager, Venue Operations,
Hospitality Recruitment Director, Catering Operations Manager). Warm intros
convert far better than cold.

---

## 3. The call (≈30 min) — learn first, pitch last

Run it like a discovery interview, not a sales call. Rules:
- **Ask about the past and the concrete, not the future and the hypothetical.**
  "How do you do it today?" beats "Would you use this?"
- **A compliment is not data.** "Looks great" tells you nothing. Only commitments
  (money, time, risk, intros) count.
- **Don't mention blockchain, ZK, wallet, or self-sovereign. Ever.** If those
  words would survive into the staff/buyer UX, the conservative buyer kills you.
- **Don't demo until Part 3.** Demoing early turns learning into pitching.

### Part 1 — Current behaviour (10 min) → tests H1a
- "Walk me through what actually happens before a new casual's first shift —
  how do you confirm they're allowed to be behind the bar?"
- "When did that last go wrong? What happened next?" *(shift re-covered? a
  licensing problem? a fine? who got called?)*
- "How often does that happen?"
- "What do you use for this today?" *(a rostering tool like Deputy or Tanda? a
  spreadsheet? a folder of certificates? the RSA register?)* "What does that cost
  you a year?"
- "What's the part of it that still annoys you / that the tool doesn't fix?"
- For catering and agencies: "When you staff an event at a site you don't
  control, who checks the tickets, and when?"

### Part 2 — Portability + authority (8 min) → tests H1b + H1c
- "When you take on someone who already works at another venue or agency, do you
  re-check everything from scratch? How long does that take?"  *(listen for
  irritation + repetition — that's H1c)*
- "How many of your casuals also work somewhere else?"
- "Who decides what apps/tools staff are required to use to get a shift?"
- "Whose budget would something like this come out of?"

### Part 3 — Demo + the mandate ask (10 min) → tests H1
Show the existing demo for **60–90 seconds**, framed plainly:
> "Here the roster is checked automatically — if anyone's RSA has lapsed or
> they've not done this venue's induction, the roster simply can't be published,
> and there's a dated record of why. And because the person carries their own
> verified profile, the next venue or event they work doesn't have to re-check
> them from zero."

The demo blocks three people for three different reasons — an expired RSA, a
missing venue induction, and an RSA revoked by the regulator — and shows the
same person cleared for the bar but not the gaming room. Let the buyer react to
which of those they recognise; that reaction is data.

Then go straight for commitment (see the bar below). Do not soften it into "what
do you think?"

---

## 4. THE YES/NO BAR (the whole point)

A verbal "yes" is worthless. Score every conversation on the **commitment ladder**
— the only real evidence is a *costly* signal: **money, time, reputation/risk, or
an intro that puts their name on the line.**

### STRONG YES (counts toward green-light)
Any one of:
- Signs / verbally commits to a **paid pilot** with a named venue or event, a
  start date, and a **per-worker price** they'll pay.
- Provides a **written mandate intent**: "we would require this at [Venue] for
  all staff" with a number attached.
- Puts **money down** (deposit / prepay) or commits **their own staff time** to
  run a scoped pilot, with an owner named.
- Makes a **warm intro to the actual mandate-authority/budget-holder** AND
  endorses it.

### MAYBE (does NOT count — re-engage later)
- "Run a *free* pilot, optional for staff." → optional = dead (casuals won't
  self-adopt). Push to mandate; if they won't, it's a Maybe.
- "Send me a proposal / let's talk when it's further along."

### NO (treat as a no, regardless of enthusiasm)
- "Looks great" / "really interesting" with no commitment.
- "We'd consider it." / "When it's ready." / "I'll show the team."
- Any praise unaccompanied by money, time, risk, or a named intro.

**The mandate sub-question that gates everything:**
> "Would you make this **required** for every person — not optional — before they
> can be rostered?"
A "no, optional" here caps the conversation at MAYBE even if they love it, because
optional adoption is the failure mode that killed every prior consumer-identity
play.

---

## 5. Scorecard (fill one per conversation)

| Field | Capture |
|---|---|
| Segment / role / mandate authority? (Y/N) | |
| Pain severity (1–5) + last failure + cost | |
| Current tool + annual spend | |
| Portability pain (1–5) — re-verify across venues/agencies? | |
| % of staff who also work elsewhere | |
| Will mandate (required, not optional)? (Y/N) | |
| Commitment reached (Strong / Maybe / No) | |
| Best quote (verbatim) | |

---

## 6. Decision rule (set before you start, so you can't rationalise)

After ~8 conversations:

- **GREEN — build Phase 1.** ≥2 **Strong** commitments (paid pilot / mandate
  intent with price) **AND** ≥5/8 confirm frequent, costly pain **AND**
  portability rates ≥3/5 for at least half. → The wedge is real; build the
  AA-wallet loop.
- **YELLOW — re-segment and re-run once.** Pain is clearly real (≥5/8) but you got
  **0 Strong** commitments. → The problem exists but you're talking to the wrong
  buyer or framing the wedge wrong (most likely: go harder at staffing agencies
  and caterers, where portability bites most). Adjust and run 6 more.
- **RED — stop and rethink the whole thesis.** <4/8 see meaningful pain, OR the
  pain is fully served by incumbents and **nobody will mandate**. → Decentralised
  identity has no pull here. Do not build the network. The year and money you
  save is the entire value of this test.

---

## 7. Logistics & traps

- **Timebox:** 2–3 weeks. Batch the outreach; aim for ~3 calls/week.
- **Record** (with consent) or take verbatim notes — you want the *quotes*, not
  your paraphrase.
- **Run them yourself.** Do not delegate founder-level discovery.
- **Traps to avoid:**
  - Talking at the wrong altitude (a duty manager can't mandate — get the
    licensee or group ops).
  - Pitching instead of learning; demoing before Part 3.
  - Banking compliments as validation.
  - Letting them stay hypothetical — always push to a concrete next commitment.
  - Anchoring price before you've learned their current spend.
  - Assuming a rostering incumbent (Deputy, Tanda and the like) doesn't already
    solve this. Ask what their tool does with certificates *today* before you
    describe what yours would do.

---

## 8. If the vertical is wrong

The console is deliberately cheap to re-point: `lib/idara/hospitality.ts` holds
the entire credential taxonomy, and the engine, verifier and audit chain below it
know nothing about RSAs. If these eight conversations say the pain is real but
hospitality is the wrong buyer, swapping the vertical pack and its seed data is
days of work, not months — which is the reason to run the test before building
anything underneath it.
