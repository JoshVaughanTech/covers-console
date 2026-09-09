# Deploying to Vercel

The app runs on Vercel as an ordinary Next.js project. Two things need doing
by hand in the dashboard, because the CLI cannot do either, and one of them
is the difference between a demo and an open door.

## 1. A database, before anything else

Vercel runs many short-lived instances with no shared disk. Without a real
Postgres each instance would open its own in-process one, and an audit chain
whose contents depend on which instance answered is not an audit chain. So a
production build **refuses to start** without `DATABASE_URL` rather than
quietly running that way.

In the dashboard: **your project → Storage → Create → Neon (Serverless
Postgres) → Connect to project**. The free tier is far more than this needs.
Connecting it sets `DATABASE_URL` on the project itself, so the credential
never has to be pasted anywhere.

Use the **pooled** connection string if you are asked to choose. Many
short-lived instances against a direct connection exhaust the server's
connection limit long before the app is busy. `PGPOOL_MAX` caps what one
instance may open, and defaults to 3 for the same reason.

No migration step: each store runs its own `CREATE TABLE IF NOT EXISTS` and
`ADD COLUMN IF NOT EXISTS` on first use, both idempotent.

### Running the driver tests against a real server

`db()` builds a `PgliteDb` when `DATABASE_URL` is absent and a `PgDb` when it is
present, and those are two implementations of `transaction()`. The whole suite
uses the first. Only `tests/pg-driver.test.ts` exercises the one that deploys,
and it is `describe.skipIf(!URL)` — so on a machine with no database it skips,
and **a skipped test reports identically to a passing one**. It reached main in
a state that failed on its first run against a real server: two cases shared
one org, so the second counted the first case's event and read thirteen
appends where it expected twelve. Not a driver fault, and invisible for as
long as nothing ran it.

Two things are needed and neither is obvious:

**A real server.** Not PGlite — the point is a connection pool with more than
one connection, which is what makes `pg_advisory_xact_lock` observable rather
than merely reasoned about. Nothing in this repo provides one. Any local
Postgres will do; an embedded one installed outside the repo works and leaves
`node_modules` alone, which matters when more than one checkout shares it.

**`?sslmode=disable` on the URL.** `freshDb()` turns SSL on for anything that
does not say otherwise, because Neon requires it. A local server without SSL
answers `The server does not support SSL connections` and every case fails on
connection, which reads like a broken driver and is a missing query parameter.

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/covers_test?sslmode=disable" npx vitest run tests/pg-driver.test.ts
```

Pointing it at the deployment's own Neon database also works: it scopes every
row to a random `org-pgtest-…` org and deletes both tables' rows for those orgs
afterwards, so it leaves other chains untouched. It does write and delete,
which is worth knowing before aiming it at anything you care about.

## 2. Protection, before the first deploy — not after

The sign-in code has to reach a person out of band, and on Vercel neither
existing channel does that:

- `AUTH_CODES_DIR` writes to a filesystem that is ephemeral and per-instance.
  The code would be written where nobody, including the person who asked for
  it, can read it.
- `AUTH_CODES_INLINE=1` returns the code in the response body. A did is
  derivable from a name on the roster, so anyone who can reach the URL can
  sign in as anyone — every roster, every credential, the whole console.

The deployment therefore runs with inline codes **and Vercel's own protection
in front of the entire site**. The protection is the security boundary. The
codes are not.

Turn it on under **Settings → Deployment Protection** before the first
deploy, not after: between deploying and enabling it, the app is public with
inline codes on.

### "Protection is on" is not the question. The scope is.

Vercel has more than one setting here, and the difference is the whole thing:

- **Standard Protection** gates preview deployments and the long
  `project-hash-team.vercel.app` deployment URLs — and **exempts the production
  alias**. The short address is open to anybody.
- **All Deployments** gates the production alias too. This is the one this
  deployment needs.

That is not hypothetical. It is what was live here: protection was correctly
enabled, reported as done, and the site was public anyway.

    covers-console-lqax80dv9-….vercel.app   Vercel SSO page   gated
    covers-console.vercel.app               the app           open

**So check the alias, not the setting.** The dashboard says "on" in both cases;
only the URL tells you which:

```bash
curl -s -L https://<your-alias>.vercel.app/ | grep -c "Log in to Vercel"
```

`1` means gated. `0` means the app is being served to whoever asks.

> **The coupling is invisible from inside the app.** Nothing in this codebase
> can detect whether Vercel's protection is on, so turning it off — or leaving
> it on the wrong scope — silently converts the deployment into one where
> anybody can sign in as anybody. That is the failure mode this codebase argues
> hardest against elsewhere: a confidentiality failure that announces itself to
> nobody. If protection ever comes off, `AUTH_CODES_INLINE` has to come off in
> the same change, which means sign-in stops working until a real delivery
> channel exists.

> **And do not read "nothing is exposed" as "it is gated".** With no
> `DATABASE_URL` and `AUTH_CODES_INLINE` unset, an open alias leaks nothing:
> `sinkFromEnv()` returns `NoSink` so sign-in 503s, and the data routes have no
> database to answer from. That is safe **because it is unconfigured**, which is
> a different property from being gated and expires the moment somebody makes
> the app work. Connecting the database is a normal, desirable act that nobody
> would think to pair with a security check — and nothing about the URL changes
> at that moment to say the assumption has lapsed.

A real channel — email or SMS — is what removes the coupling. It needs a
provider account, a verified sender, and an address or mobile number per
worker, none of which the roster currently carries.

## Environment variables

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | set by connecting Neon | everything durable |
| `PGPOOL_MAX` | leave unset (3) | the ceiling is the server's, shared |
| `AUTH_CODES_INLINE` | `1` | only valid behind deployment protection |
| `AUTH_CODES_DIR` | leave unset | ephemeral, per-instance, unreadable |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | from `node scripts/generate-vapid-keys.mjs` | web push; without them the offer is still recorded and simply not pushed |
| `COVERS_ORG` | leave unset | defaults to the demo org |

Connecteam variables stay unset unless live break-compliance data is wanted;
blank means demo data, which is what a deployment behind a password should
show anyway.

## What is worse on serverless than it is locally

**The event stream goes quiet across instances.** `EventStore.subscribe()` is
an in-process EventEmitter, so a browser holding `/api/events/stream` open
against one instance never hears an append that landed on another. It is not
a correctness problem — the route replays from the client's cursor on every
reconnect, so nothing is lost, it arrives late. Fixing it properly means
Postgres `LISTEN`/`NOTIFY` held open for the life of the streaming function,
or polling the head.

**Push needs the keys set on the project.** They are read at send time, not
build time, so adding them later works without a redeploy — but every
existing subscription was created against the public key it was given, so
changing them silently stops delivery to every phone already subscribed.
