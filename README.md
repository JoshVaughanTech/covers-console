# FairShift Console

The desktop **workforce operations** web app for **FairShift** — *powered by idara* (identity &
credential verification). Built from the FairShift design system handoff as a real
**Next.js 15 + TypeScript + Tailwind v4** application (the handoff prototypes were React-via-Babel
references; this is the production recreation).

> One platform. Every workforce need. — connecting **roster → attendance → labour cost → projects →
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
```

## Routes (console modules)

| Route | Screen | Status |
|---|---|---|
| `/overview` | Operations dashboard (fairness, live attendance, heatmap, activity) | ✅ recreated |
| `/schedule` | AI-powered scheduling (roster grid, AI preview, suggestions) | ✅ recreated |
| `/attendance` | Time & Attendance (live status, variance table, job profitability) | ✅ recreated |
| `/credentials` | Credentials & Eligibility — *Idara Verify* | ✅ recreated |
| `/comms` | Communications (job rooms, chat, acknowledgements) | ✅ recreated |
| `/projects` | Projects (task board, timeline, verified sign-off) | ✅ recreated |
| `/jobs`, `/people`, `/reports`, `/settings` | — | placeholder |

`/` redirects to `/overview`.

## Project structure

```
app/
  globals.css            # design tokens (@theme + :root) + type/chrome styles
  layout.tsx             # root: fonts (next/font), <html>/<body>
  page.tsx               # redirect → /overview
  (console)/
    layout.tsx           # app shell: Sidebar + Topbar + scrollable workspace
    overview/ schedule/ attendance/ credentials/ comms/ projects/   # screens
    jobs/ people/ reports/ settings/                                # placeholders
components/
  ui/                    # Icon, Button, Badge, Card, Avatar/Stack, Ring, Bar, Spark, MetricCard, Check
  chrome/                # Sidebar, Topbar, nav model
  screen/                # PageHead, CardHead, LinkBtn, Placeholder
lib/
  status.ts              # STATUS tone map (success/warning/danger/info/teal/neutral)
public/assets/           # FairShift + idara logos & marks
```

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
- **Avatars** are initials-on-tint placeholders — swap for real worker photos.
- **Logos** were cropped from raster artwork — request SVG originals for production.
- Screen data is **mock/seed data** lifted from the reference designs. Wire to real APIs
  (auth, scheduling, time-tracking, messaging, idara verification) for production.
