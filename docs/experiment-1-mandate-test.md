# Experiment 1 — The Mandate Test

> **Purpose:** find out, before building the wallet/ZK/network, whether a real
> construction employer or labour-hire firm will **mandate** worker use of Idara
> and **pay per head** to gate rostering/site-access on verified credentials.
>
> Adoption in B2B2C has exactly one realistic engine: an employer who *requires*
> it. If no one will mandate it, the whole self-sovereign-identity venture has no
> distribution and should not be built. This test costs ~2–3 weeks and zero new
> code (it uses the existing Schedule + Audit demo).

---

## 1. The hypothesis (falsifiable)

**H1 (primary):** A construction employer / labour-hire firm will *require* its
workers to use Idara and *pay a per-worker recurring fee* to gate
rostering/site-access on verified credentials.

Supporting sub-hypotheses, each independently testable:
- **H1a — Pain is real, frequent, costly.** Verifying eligibility today is
  painful enough to spend money/time on, and failures cause stand-downs, rework,
  fines, or safety/near-miss exposure.
- **H1b — There is a person with the authority + budget to mandate.** The buyer
  can both *require* the tool and *pay* for it.
- **H1c — Portability is felt.** Workers re-verify the same credentials across
  many employers/sites, and someone is annoyed enough by that to want it fixed.

H1c is the only thing that justifies *decentralisation* over a centralised
incumbent. If H1a/H1b pass but H1c fails, you have a SaaS opportunity, not an
identity-network one.

**This test does NOT validate:** ZK, blockchain, self-sovereignty as features.
Nobody buys those. We're testing the *job*, the *mandate*, and the *money*.

---

## 2. Who to talk to (and who NOT to)

Target **8 conversations**, weighted toward the high-churn segment where
portability bites:

| Segment | # | Why | Who exactly |
|---|---|---|---|
| Labour-hire / recruitment firms | 3 | Highest credential churn; workers span many employers → portability pain | Director / Ops manager |
| Principal contractors (use lots of subbies/casuals) | 3 | The relying party + the mandate authority | HSE/Safety head, Site/Ops manager |
| Subcontractor owners | 2 | Carry workers between many sites | Owner/principal |

**Authority filter — non-negotiable:** you must reach someone who can *require*
what workers use. A foreman or HR admin cannot mandate. If your contact can't,
your only goal for that call is an intro to the person who can.

**Where to find them:** existing network first; then Master Builders Association
/ HIA chapters, labour-hire industry groups, LinkedIn (HSE Manager, Ops Manager,
Labour Hire Director titles). Warm intros convert far better than cold.

---

## 3. The call (≈30 min) — learn first, pitch last

Run it like a discovery interview, not a sales call. Rules:
- **Ask about the past and the concrete, not the future and the hypothetical.**
  "How do you do it today?" beats "Would you use this?"
- **A compliment is not data.** "Looks great" tells you nothing. Only commitments
  (money, time, risk, intros) count.
- **Don't mention blockchain, ZK, wallet, or self-sovereign. Ever.** If those
  words would survive into the worker/buyer UX, the conservative buyer kills you.
- **Don't demo until Part 3.** Demoing early turns learning into pitching.

### Part 1 — Current behaviour (10 min) → tests H1a
- "Walk me through what actually happens before a new worker's first shift on
  site — how do you confirm they're allowed to be there?"
- "When did that last go wrong? What happened next?" *(stand-down? rework? fine?
  near-miss? who got called?)*
- "How often does that happen?"
- "What do you use for this today?" *(Damstra / Rapid Global / HammerTech /
  spreadsheets / paper?)* "What does that cost you a year?"
- "What's the part of it that still annoys you / that the tool doesn't fix?"

### Part 2 — Portability + authority (8 min) → tests H1b + H1c
- "When you take on a worker who's already been verified by another
  employer/agency, do you re-check everything from scratch? How long does that
  take?"  *(listen for irritation + repetition — that's H1c)*
- "Who decides what apps/tools workers are required to use to get on your sites?"
- "Whose budget would something like this come out of?"

### Part 3 — Demo + the mandate ask (10 min) → tests H1
Show the existing demo for **60–90 seconds**, framed plainly:
> "Here a worker's credentials are checked automatically — if anyone's induction
> or licence has lapsed, the roster simply can't be published, and there's a
> dated record of why. And because the worker carries their own verified profile,
> the next site they go to doesn't have to re-check them from zero."

Then go straight for commitment (see the bar below). Do not soften it into "what
do you think?"

---

## 4. THE YES/NO BAR (the whole point)

A verbal "yes" is worthless. Score every conversation on the **commitment ladder**
— the only real evidence is a *costly* signal: **money, time, reputation/risk, or
an intro that puts their name on the line.**

### STRONG YES (counts toward green-light)
Any one of:
- Signs / verbally commits to a **paid pilot** with a named site, a start date,
  and a **per-worker price** they'll pay.
- Provides a **written mandate intent**: "we would require this on [Site] for all
  workers" with a number attached.
- Puts **money down** (deposit / prepay) or commits **their own staff time** to
  run a scoped pilot, with an owner named.
- Makes a **warm intro to the actual mandate-authority/budget-holder** AND
  endorses it.

### MAYBE (does NOT count — re-engage later)
- "Run a *free* pilot, optional for workers." → optional = dead (workers won't
  self-adopt). Push to mandate; if they won't, it's a Maybe.
- "Send me a proposal / let's talk when it's further along."

### NO (treat as a no, regardless of enthusiasm)
- "Looks great" / "really interesting" with no commitment.
- "We'd consider it." / "When it's ready." / "I'll show the team."
- Any praise unaccompanied by money, time, risk, or a named intro.

**The mandate sub-question that gates everything:**
> "Would you make this **required** for every worker — not optional — before they
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
| Portability pain (1–5) — re-verify across employers? | |
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
  buyer or framing the wedge wrong (most likely: go harder at labour-hire, where
  portability bites most). Adjust and run 6 more.
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
  - Talking at the wrong altitude (a foreman can't mandate — get the
    decision-maker).
  - Pitching instead of learning; demoing before Part 3.
  - Banking compliments as validation.
  - Letting them stay hypothetical — always push to a concrete next commitment.
  - Anchoring price before you've learned their current spend.
```
