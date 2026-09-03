# Design — Break Compliance backend, and the supervisor mobile app

**Date:** 2026-09-03 · **Status:** designed, awaiting implementation

The point at which the console stops being a demo. Today the board, the roster and
the audit chain all live in browser memory, so two supervisors on two phones would
each see a private reality. This is the smallest architecture that makes multi-device
real without becoming a separate service.

---

## 1. The shape: store what happened, not what is

Three things live in the browser today. Only one needs a database.

- **Sessions stay Connecteam's.** Already fetched per request via `/api/breaks`; the
  phone hits the same route. No change.
- **The assessment stays pure and client-side.** `assess()` is isomorphic and ticks
  every second. Shipping it to both clients is what makes the phone and the dashboard
  agree *by construction* rather than by syncing. Server-side would mean either
  polling Connecteam per second or serving stale timers.
- **Decisions and the chain persist.** A `break.decision` is the only thing a
  supervisor creates, and the only thing that must survive a refresh, appear on
  another device, and still verify in six months.

So the server owns an **append-only event store and nothing else**. Each client
derives the board from `sessions + events`.

```
Connecteam ──punches──▶ /api/breaks ──▶ ┌─ console (desktop)
                                        └─ phone (/m/*)
                              │                    │
                         assess() runs        assess() runs
                              │                    │
                              └──▶ POST /api/breaks/decision ◀──┘
                                        │
                                   Postgres (chain)
                                        │
                                  SSE ──┴──▶ both clients
```

One Next app, two route groups. The phone is `/m/*` with its own layout, not a
responsive squeeze of the console.

---

## 2. Decisions taken

| Decision | Chosen | Rejected, and why |
|---|---|---|
| How far to go | **Postgres behind the existing Next app** | A separate service is the right shape for real multi-tenant load, but it is a lot of architecture to answer a question the single app can already answer. Demo-grade shared state was rejected outright: a restart clearing the audit log is exactly what an audit log must not do. |
| Chain under concurrency | **One chain, serialised by a row lock on `chain_head`** | `appendEvent` reads the tail for `prevHash` and `seq` — a read-modify-write, safe in one tab and a forked chain with two phones. A chain per site removes contention but makes "the audit log" N logs and complicates Verify Integrity. A DAG handles concurrency natively but gives up total order, which is most of why the log exists. At ~30 events per venue per day, serial append is nowhere near a bottleneck. |
| Offline | **Queue locally, sync when back** | The decision keeps the time it was taken and is appended when signal returns: `at` 13:56, `recordedAt` 14:20. The chain orders *recording*, not *occurrence*, and the gap is shown rather than hidden. Blocking writes offline means the break still happens and nothing records it; optimistic-with-no-queue means loading keeps accruing against a break the system never saw. |
| Identity | **Personal sign-in, long-lived session** | Magic link to a work email, session persists across shifts, so every decision carries a real person into the chain. A shared device with a PIN per action puts friction at the 6h mark, which is where it costs money. Leaving `actor` generic would mean the log cannot answer "who sent them", which is most of what it is for. |
| Effect in Connecteam | **Write through, and audit the outcome** | Payroll runs off Connecteam, so a break Covers knows about and Connecteam does not is a break that never happened as far as pay is concerned. Covers-only keeps the integration read-only but lets the two systems disagree. Write-through *without* a local chain gives up the tamper-evident record Covers exists to provide. |
| Transport | **SSE** | One-way server→client, survives proxies, and reconnects natively with `Last-Event-ID`, which maps exactly onto `since=seq`. WebSockets buy bidirectionality nothing here needs. |

---

## 3. The write path

A decision now has **two effects that fail independently**: it must reach Connecteam's
timesheet or payroll will not see it, and Covers' chain or there is no evidence.
Treating them as one operation is the trap.

```
1. append  break.decision   { pushed: "pending", at, client_ref }   ← ours, always succeeds
2. POST    /time-clock/v1/time-clocks/{id}/manual-breaks/{mbId}/clock-in
3. append  break.pushed     { ok: true, ctBreakId }
        or break.push_failed { reason, retryable }
```

**The chain entry comes first, deliberately.** Pushing first and appending second means
a crash between them loses the supervisor's decision — the one thing that must never be
lost, because it is the evidence the break was given. Appending first means the worst
case is a decision we know about and can retry.

**`pushed` is a state, not a boolean** — `pending → ok | failed`, resolved by a *second
event* rather than by mutating the first. Mutating would break the chain, which is the
point of it.

This **subsumes the offline queue**: an offline decision is a push stuck at `pending`
for longer. One mechanism, whether the gap was 200 ms or 20 minutes.

---

## 4. Schema and API

```sql
audit_event   org_id, seq, id, type, at, recorded_at, actor,
              subject, summary, data jsonb, prev_hash, hash
              PRIMARY KEY (org_id, seq)
              UNIQUE (org_id, client_ref)      -- idempotency

chain_head    org_id PRIMARY KEY, seq, hash    -- the row the append locks
supervisor    id, did, email, name, revoked_at
session       token_hash, supervisor_id, expires_at, last_seen
```

**No mirror tables.** An earlier draft proposed local copies of people and shifts to
join across systems. Re-examined: the board needs sessions (Connecteam, per request)
and events (ours), and nothing joins at rest — names ride on the session payload. A
mirror becomes necessary only when credentials move to Connecteam, and building it now
would be a cache with no reader.

**`client_ref` is what stops offline hurting.** A phone retrying after a timeout cannot
tell a lost request from a slow one. The client mints a ref per decision; the unique
constraint makes the second append a no-op returning the first result. Without it,
flaky bar Wi-Fi produces duplicate break records on a compliance document.

| Route | Does |
|---|---|
| `POST /api/breaks/decision` | append → push → append outcome, in one handler so no client can get it half-right |
| `GET /api/events?since=` | catch-up after reconnect |
| `GET /api/events/stream` | SSE fan-out |
| `POST /api/auth/link` · `/callback` | magic link |
| `GET /api/breaks` | unchanged |

---

## 5. Failure handling

| Failure | Behaviour |
|---|---|
| Two supervisors append at once | Second waits on the `chain_head` lock. Queues, never forks. |
| Push fails, retryable | `pending` → backoff retry → `break.pushed` |
| Push fails terminally | `break.push_failed` with reason, shown on the board |
| Connecteam down entirely | Phase 1 still succeeds; decisions are unpushed, never lost |
| `time_clock.write` not granted | Covers-only record, **and the UI says so** rather than implying the timesheet was updated |
| SSE drops | Reconnect with `Last-Event-ID` → `since=seq` |
| Phone retries a queued decision | `client_ref` collision returns the original |

The one that needs a screen rather than a log: **a `pending` older than a few minutes**.
That is Covers claiming a break was given while the timesheet disagrees — the exact
divergence write-through exists to prevent, so it belongs where the supervisor is
looking.

---

## 6. Migration

Smaller than it sounds, because **the provider is the seam**. `IdaraProvider` holds
`auditLog` in `useState` and exposes `recordEvent`. Swap the internals — read from
`GET /api/events` on mount, `recordEvent` POSTs, SSE folds updates back in — and the
public surface is unchanged, so `/audit`, `/breaks` and `/schedule` need no edits.
`SEED_AUDIT` becomes a database seed, so demo mode survives.

---

## 7. Testing

**The test that justifies the design:** fire N concurrent appends, then assert
`verifyChain` passes and the sequence is `0..N-1` with no gaps and no duplicates. If
that holds under contention the lock is doing its job; if the lock is ever removed,
that test fails loudly.

The rest is ordinary: idempotency under a repeated `client_ref`; two-phase resolution
from `pending` to `pushed` and to `push_failed`; degradation when `time_clock.write` is
absent; and `verifyChain` run over the database rather than an in-memory array.

---

## 8. What this depends on

`time_clock.write` is not currently granted — the integration holds only
`time_clock.read` and `schedule.read` (see the 2026-09-03 discovery). Until it is, the
write-through path degrades to a Covers-only record and says so. That is a deliberate
state, not a defect: a migrating customer sits in partial scopes for weeks.

> Not legal advice. Verify against current award text and any EBA before relying on
> these figures.
