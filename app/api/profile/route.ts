/* ============================================================
   GET /api/profile — what this worker holds, and what it is worth.

   The screen it feeds exists to make one claim true:

     WHAT YOU SEE HERE WAS VERIFIED, NOT SELF-DECLARED.

   So nothing on it is assembled by the phone. Credential state is
   standingOf() — the same derivation the Credentials and People
   screens use, which is why a licence amber here is amber there.
   The award floor is floorHourly(), the same function that refuses
   an underpaying posting. What another credential would unlock is
   the gate's own answer to a counterfactual, not a guess.

   Three numbers the mockup shows are deliberately NOT here:
   lifetime shifts worked, venues worked, and a reliability
   percentage. Nothing in this system records shift history yet, so
   every one of them would be invented — and inventing them on the
   screen whose whole argument is "this was checked" is the worst
   possible place to start. Hours this week is real and is included.
   ============================================================ */
import { NextResponse } from "next/server";
import { eventStore } from "@/lib/store/events";
import { boardFrom, unlocksFor } from "@/lib/shifts";
import { LocalCredentialVerifier } from "@/lib/idara/verifier";
import { SITES } from "@/lib/idara/seed";
import { CREDENTIAL_TYPES, standingOf } from "@/lib/idara";
import { profileOf, SKILLS, type SkillId } from "@/lib/people";
import { floorHourly, fmtAud } from "@/lib/awards";
import { workerOf } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const FULL_WEEK_HOURS = 38;

const siteIndex = new Map(SITES.map((s) => [s.id, s]));
const verifier = new LocalCredentialVerifier();

export async function GET(req: Request) {
  const caller = (await workerOf(req));
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { did, person } = caller;
  const board = boardFrom((await (await eventStore()).all(ORG)));
  const profile = profileOf(did);

  const standing = standingOf(did, board.credentials, board.at, verifier);

  const unlocks = unlocksFor({
    person,
    credentials: board.credentials.filter((c) => c.subject === did),
    postings: board.postings,
    siteOf: (id) => siteIndex.get(id),
    at: board.at,
    verifier,
  });

  /* The floor for their own classification, on an ordinary weekday. Sent as
     both cents and a formatted string so the phone renders money without
     owning a second copy of the formatting. */
  const award = profile
    ? (() => {
        const cents = floorHourly(profile.award.level, profile.award.employment);
        return {
          level: profile.award.level,
          levelLabel: profile.award.level === "introductory" ? "Introductory" : `Level ${profile.award.level}`,
          employment: profile.award.employment,
          weekdayFloorCents: cents,
          weekdayFloor: fmtAud(cents),
          awardId: "MA000009",
        };
      })()
    : null;

  return NextResponse.json({
    worker: { did, name: person.name, role: person.role },
    at: board.at,
    /* "current" | "expiring" | "action_needed" — one word for the whole
       person, so the header can be honest without the reader parsing a list. */
    standing: standing.state,
    credentials: standing.held
      .map((h) => ({
        type: h.credential.type,
        shortLabel: CREDENTIAL_TYPES[h.credential.type].shortLabel,
        label: CREDENTIAL_TYPES[h.credential.type].label,
        authority: CREDENTIAL_TYPES[h.credential.type].authority,
        state: h.state,
        expiresAt: h.credential.expiresAt,
        daysLeft: h.daysLeft,
      }))
      // problems first: the only rows on this list that need an action
      .sort((a, b) => Number(a.state === "current") - Number(b.state === "current")),
    unlocks: unlocks.map((u) => ({
      type: u.type,
      shortLabel: u.shortLabel,
      label: u.label,
      authority: u.authority,
      siteScoped: u.siteScoped,
      // a scoped credential is per venue; the row has to name which one, or it
      // reads as one errand when it is several
      siteName: u.siteName ?? null,
      shifts: u.postingIds.length,
    })),
    skills: profile
      ? (Object.keys(profile.skills) as SkillId[])
          .map((s) => ({ skill: s, label: SKILLS[s].label, level: profile.skills[s]! }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : [],
    rating: profile?.rating ?? null,
    hours: profile ? { thisWeek: profile.hoursThisWeek, fullWeek: FULL_WEEK_HOURS } : null,
    award,
  });
}
