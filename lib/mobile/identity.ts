/* ============================================================
   Who is holding the phone.

   Every break decision carries an actor into the hash chain, and
   until now that actor was the literal string "Supervisor" — so the
   log recorded that a break was given but never by whom, which is
   most of what a compliance log is for.

   This is identification, not authentication. Anyone can pick any
   name; nothing verifies it. That is a deliberate first step rather
   than a pretence: a real session needs a delivered magic link, and
   the design has one. What this buys today is that the chain names a
   person instead of a role, and the swap to a verified session later
   changes where `did` comes from, not what the chain records.

   Stored per device because a phone belongs to a person. A shared
   venue tablet would need a per-action prompt instead, which is the
   other branch the design considered and rejected for costing
   friction at the six-hour mark.
   ============================================================ */

const KEY = "covers.supervisor";

export interface Supervisor {
  did: string;
  name: string;
  role: string;
}

/** Whoever this device is signed in as, or null on first run. */
export function currentSupervisor(): Supervisor | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Supervisor>;
    // a half-written or stale shape is treated as signed out rather than
    // trusted — an actor with no did would land in the chain unusable
    return s.did && s.name ? { did: s.did, name: s.name, role: s.role ?? "" } : null;
  } catch {
    return null;
  }
}

export function setSupervisor(s: Supervisor): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode, or storage full — the caller keeps it in memory for
       this session rather than failing the sign-in outright */
  }
}

export function clearSupervisor(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do; the next read will simply return what is there */
  }
}
