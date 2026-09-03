"use client";

/* ============================================================
   Idara Core — React provider
   Mounts the trust layer into the app: holds identities,
   credentials, sites and the audit log, and exposes the engine
   to any module via useIdara().

   decideFor()  — pure eligibility preview, no audit (cheap, for UI).
   publishRoster() — runs the engine per worker, blocks ineligible
                     ones, and writes an audit event. This is the
                     proof that a roster cannot be published with a
                     non-compliant worker on it.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { LocalCredentialVerifier } from "./verifier";
import { CREDENTIAL_TYPES } from "./hospitality";
import {
  decideMember,
  decideRoster,
  summarise,
  summariseCoverage,
  type ShiftAssignment,
} from "./engine";
import { appendEvent, type NewAuditEvent } from "./audit";
import { CREDENTIALS, SITES, WORKERS, TODAY, SEED_AUDIT } from "./seed";
import type {
  Action,
  AuditEvent,
  CoverageCheck,
  Credential,
  Decision,
  DID,
  Identity,
  Site,
} from "./types";

/**
 * One slot on a roster: who, and which shifts they are on.
 *
 * Duties belong to a shift rather than to a week — someone can be fine behind
 * the bar Monday to Thursday and ineligible for Saturday's gaming shift.
 */
export interface RosterAssignment {
  did: DID;
  shifts?: ShiftAssignment[];
}

export interface PublishResult {
  decisions: Decision[];
  eligible: Decision[];
  blocked: Decision[];
  warnings: Decision[];
  /** roster-level requirements — a venue's nominated FSS and the like. */
  coverage: CoverageCheck[];
  /** collective requirements the roster fails to cover. */
  uncovered: CoverageCheck[];
  published: boolean;
}

interface IdaraState {
  today: string;
  workers: Identity[];
  credentials: Credential[];
  sites: Site[];
  auditLog: AuditEvent[];
  /** credentials held by one subject. */
  credentialsOf: (did: DID) => Credential[];
  worker: (did: DID) => Identity | undefined;
  site: (id: string) => Site | undefined;
  /** pure eligibility preview — does NOT write to the audit log. */
  decideFor: (
    did: DID,
    action: Action,
    siteId: string,
    shifts?: ShiftAssignment[],
  ) => Decision | null;
  /** pure pass over a roster — eligible / blocked / warnings. No audit. */
  evaluateRoster: (siteId: string, roster: RosterAssignment[]) => PublishResult;
  /** write the publish outcome (clean OR blocked attempt) to the audit log. */
  recordPublish: (siteId: string, result: PublishResult, actor?: string) => void;
  revokeCredential: (credId: string, actor?: string) => void;
  /** append any consequential event from a module (e.g. a break sent under cl 16). */
  recordEvent: (ev: NewAuditEvent) => void;
}

/**
 * A publish can now be blocked by individuals, by the roster as a whole, or
 * by both at once — the audit summary has to say which.
 */
function blockedSummary(siteName: string, r: PublishResult): string {
  const parts: string[] = [];
  if (r.blocked.length > 0) {
    parts.push(
      `${r.blocked.length} ineligible staff member${r.blocked.length === 1 ? "" : "s"}`,
    );
  }
  for (const c of r.uncovered) {
    parts.push(`no ${CREDENTIAL_TYPES[c.type].shortLabel} on shift`);
  }
  return `Publish blocked for ${siteName} — ${parts.join(" and ")}`;
}

const IdaraContext = createContext<IdaraState | null>(null);

export function IdaraProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credential[]>(CREDENTIALS);
  /*
   * The chain is durable now: the server owns it, this holds a replica.
   *
   * SEED_AUDIT is the starting value rather than the source of truth, so the
   * screens render immediately and are replaced by the server's chain on the
   * first read. If the API is unreachable the seed simply stays, which keeps
   * the console working offline as a demo instead of showing an empty log.
   */
  const [auditLog, setAuditLog] = useState<AuditEvent[]>(SEED_AUDIT);
  const [durable, setDurable] = useState(false);
  /** highest seq folded in, so a reconnect resumes rather than replays */
  const cursor = useRef(-1);

  /** Fold events in by seq, ignoring any we already hold. */
  const fold = useCallback((incoming: AuditEvent[]) => {
    if (incoming.length === 0) return;
    setAuditLog((log) => {
      const seen = new Set(log.map((e) => e.seq));
      const added = incoming.filter((e) => !seen.has(e.seq));
      if (added.length === 0) return log;
      return [...log, ...added].sort((a, b) => a.seq - b.seq);
    });
    cursor.current = Math.max(cursor.current, ...incoming.map((e) => e.seq));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/events");
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { events: AuditEvent[] };
        if (!live) return;
        // the server's chain replaces the seed wholesale — mixing the two would
        // interleave two different genesis chains and fail verification
        setAuditLog(body.events);
        cursor.current = body.events.at(-1)?.seq ?? -1;
        setDurable(true);
      } catch {
        // no backend: stay on the seed and keep working
      }
    })();
    return () => { live = false; };
  }, []);

  /* Live appends from other devices. Only once the chain is durable — with no
     backend there is nothing to stream, and EventSource would retry forever. */
  useEffect(() => {
    if (!durable) return;
    const es = new EventSource(`/api/events/stream?since=${cursor.current}`);
    es.onmessage = (m) => {
      try { fold([JSON.parse(m.data) as AuditEvent]); } catch { /* ignore a partial frame */ }
    };
    return () => es.close();
  }, [durable, fold]);

  const verifier = useMemo(() => new LocalCredentialVerifier(), []);

  const workerIndex = useMemo(
    () => new Map(WORKERS.map((w) => [w.did, w])),
    [],
  );
  const siteIndex = useMemo(() => new Map(SITES.map((s) => [s.id, s])), []);

  const credentialsOf = useCallback(
    (did: DID) => credentials.filter((c) => c.subject === did),
    [credentials],
  );

  /*
   * Append.
   *
   * With a backend, the server is the only writer: it holds the lock that
   * decides seq and prevHash, so the client cannot know either until it
   * answers. An optimistic local append would have to guess a seq, and a guess
   * that differs from the server's leaves a phantom entry no reconciliation
   * can match. The round trip is a few milliseconds against a log view.
   *
   * Without a backend it appends locally, which is what keeps the console
   * usable as a demo with no server behind it.
   */
  const record = useCallback(
    (ev: NewAuditEvent) => {
      if (!durable) {
        setAuditLog((log) => appendEvent(log, ev));
        return;
      }
      void (async () => {
        try {
          const res = await fetch("/api/events", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...ev, clientRef: crypto.randomUUID() }),
          });
          if (!res.ok) throw new Error(String(res.status));
          const { event } = (await res.json()) as { event: AuditEvent };
          fold([event]);
        } catch {
          // the server refused or is unreachable. Recording locally would put
          // an event in the log that no chain contains, so the log stays as it
          // is and the next read reconciles from the server.
        }
      })();
    },
    [durable, fold],
  );

  const decideFor = useCallback(
    (
      did: DID,
      action: Action,
      siteId: string,
      shifts?: ShiftAssignment[],
    ): Decision | null => {
      const person = workerIndex.get(did);
      const site = siteIndex.get(siteId);
      if (!person || !site) return null;
      return decideMember({
        person,
        credentials: credentials.filter((c) => c.subject === did),
        action,
        site,
        at: TODAY,
        verifier,
        shifts,
      });
    },
    [workerIndex, siteIndex, credentials, verifier],
  );

  const evaluateRoster = useCallback(
    (siteId: string, assignments: RosterAssignment[]): PublishResult => {
      const site = siteIndex.get(siteId);
      const roster = assignments
        .map((a) => ({ a, person: workerIndex.get(a.did) }))
        .filter((x): x is { a: RosterAssignment; person: Identity } => x.person !== undefined)
        .map(({ a, person }) => ({
          person,
          credentials: credentials.filter((c) => c.subject === person.did),
          shifts: a.shifts,
        }));

      if (!site) {
        return { decisions: [], eligible: [], blocked: [], warnings: [], coverage: [], uncovered: [], published: false };
      }

      const { decisions, coverage, allowed } = decideRoster({
        roster,
        action: "be_rostered",
        site,
        at: TODAY,
        verifier,
      });

      const eligible = decisions.filter((d) => d.allowed);
      const blocked = decisions.filter((d) => !d.allowed);
      const warnings = decisions.filter((d) => d.allowed && d.warnings > 0);
      const uncovered = coverage.filter((c) => !c.met);
      return { decisions, eligible, blocked, warnings, coverage, uncovered, published: allowed };
    },
    [workerIndex, siteIndex, credentials, verifier],
  );

  const recordPublish = useCallback(
    (siteId: string, result: PublishResult, actor = "Emma Taylor") => {
      const site = siteIndex.get(siteId);
      setAuditLog((log) => {
        let next = log;
        if (!result.published) {
          // the receipts: one decision record per blocked worker…
          for (const d of result.blocked) {
            next = appendEvent(next, {
              type: "decision",
              at: TODAY,
              actor,
              subject: d.context.subject,
              summary: `${d.context.subjectName}: ${summarise(d)}`,
              data: { siteId, reasons: d.reasons.filter((r) => r.outcome === "fail") },
            });
          }
          // …a record of any collective gap…
          const coverageGap = summariseCoverage(result.coverage);
          if (coverageGap) {
            next = appendEvent(next, {
              type: "decision",
              at: TODAY,
              actor,
              summary: `${site?.name ?? siteId}: ${coverageGap}`,
              data: { siteId, uncovered: result.uncovered },
            });
          }
          // …then the blocked publish attempt itself
          next = appendEvent(next, {
            type: "roster.published",
            at: TODAY,
            actor,
            summary: blockedSummary(site?.name ?? siteId, result),
            data: {
              siteId,
              attempted: result.decisions.length,
              blocked: result.blocked.length,
              uncovered: result.uncovered.map((c) => c.type),
              published: false,
            },
          });
        } else {
          next = appendEvent(next, {
            type: "roster.published",
            at: TODAY,
            actor,
            summary: `Roster published for ${site?.name ?? siteId} — ${result.eligible.length} staff, all eligible`,
            data: { siteId, eligible: result.eligible.length, warnings: result.warnings.length, published: true },
          });
        }
        return next;
      });
    },
    [siteIndex],
  );

  const revokeCredential = useCallback(
    (credId: string, actor = "Emma Taylor") => {
      setCredentials((list) => {
        const target = list.find((c) => c.id === credId);
        if (target) {
          record({
            type: "credential.revoked",
            at: TODAY,
            actor,
            subject: target.subject,
            summary: `${target.type} revoked`,
            data: { credId, type: target.type },
          });
        }
        return list.map((c) => (c.id === credId ? { ...c, status: "revoked" } : c));
      });
    },
    [record],
  );

  const value = useMemo<IdaraState>(
    () => ({
      today: TODAY,
      workers: WORKERS,
      credentials,
      sites: SITES,
      auditLog,
      credentialsOf,
      worker: (did) => workerIndex.get(did),
      site: (id) => siteIndex.get(id),
      decideFor,
      evaluateRoster,
      recordPublish,
      revokeCredential,
      recordEvent: record,
    }),
    [credentials, auditLog, credentialsOf, workerIndex, siteIndex, decideFor, evaluateRoster, recordPublish, revokeCredential, record],
  );

  return <IdaraContext.Provider value={value}>{children}</IdaraContext.Provider>;
}

export function useIdara(): IdaraState {
  const ctx = useContext(IdaraContext);
  if (!ctx) throw new Error("useIdara must be used within an IdaraProvider");
  return ctx;
}
