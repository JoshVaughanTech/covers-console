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

**Everything goes on Preview. Production is deliberately empty, and that is
not an oversight to tidy up.**

| Variable | Value | Environment | Why |
|---|---|---|---|
| `DATABASE_URL` | the pooled Neon string | **Preview only** | everything durable |
| `PGPOOL_MAX` | leave unset (3) | — | the ceiling is the server's, shared |
| `AUTH_CODES_INLINE` | `1` | **Preview only** | only ever valid behind a gate |
| `AUTH_CODES_DIR` | leave unset | — | ephemeral, per-instance, unreadable |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | from `node scripts/generate-vapid-keys.mjs` | web push; without them the offer is still recorded and simply not pushed |
| `COVERS_ORG` | leave unset | defaults to the demo org |

Connecteam variables stay unset unless live break-compliance data is wanted;
blank means demo data, which is what a deployment behind a password should
show anyway.

### Why Production has nothing on it

The obvious future change is to move these to Production, because that is
where the app runs. That reasoning is correct and the premise it rests on is
the thing this section exists to write down.

Both the production alias and the preview URLs are gated by Vercel
Authentication. Production being empty is the **second** thing that would have
to fail, and it fails closed: if protection is ever flipped back, the alias
serves an app with no database and a `NoSink` that 503s. Inert.

Put these variables on Production and that same flip yields a live app handing
sign-in codes to anyone who asks, with a dashboard toggle as the only thing
that was ever in the way.

**The gated alias is what makes Preview-only safe to keep — not what makes it
unnecessary.** Those two read identically from outside and lead to opposite
decisions.

The reason to distrust a single toggle is first-hand rather than theoretical.
While this deployment was being set up, `vercel project protection enable
--sso` returned success, genuinely changed `ssoProtection.deploymentType`, and
left `/m` serving 200 to anyone: the scope it set was
`prod_deployment_urls_and_all_previews`, and only `all` covers the production
alias. Not a bug and not ambiguous naming — the command did exactly what it
said, to the wrong scope, and reported success. It was caught by re-testing the
URL rather than by reading the setting back.

So the guarantee does not rest there alone. Use the preview URL; leave the
alias inert.

## The console does not work on this deployment, on purpose

`POST /api/auth/console/request` returns **503** with a message about
`AUTH_CODES_DIR`. That is the design working, not a misconfiguration, and it is
worth knowing before somebody spends an afternoon on it.

The route does not consult `sinkFromEnv()` at all. Its own comment says why:

> Only ever a file. `sinkFromEnv()` is not consulted, because it can return the
> inline sink and this is the one code that must never travel that way.

An operator session mints other people's credentials, so an operator code
returned in a response body is worth more to an attacker than a worker's. On
Vercel the only writable filesystem is ephemeral and per-instance, so a
`FileSink` here would write the code where nobody — including the person who
asked for it — can read it. File-only plus no usable filesystem equals no
console.

**What works instead:** the worker app at `/m`. Those codes come back inline,
which is what `AUTH_CODES_INLINE` on Preview is for, and it is the phone
experience the deployment exists to show.

**What would change it**, in increasing order of how much it deserves:

1. A channel that proves delivery — email to a verified address, SMS to a
   number on the roster. This retires the question rather than answering it,
   and is the only option that makes the console safe on a public URL.
2. A second, separate opt-in — deliberately **not** `AUTH_CODES_INLINE`, because
   sharing that flag would mean enabling inline codes for a demo silently also
   handing out operator codes. Two doors, opened independently.

Option 2 was written and deliberately not merged. The reasoning that argues for
it — "nobody can reach this server without a Vercel account" — is the same
shape as "the alias is gated", and this file already declines to rest a
guarantee there.

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
