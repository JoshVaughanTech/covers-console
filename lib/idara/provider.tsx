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
import { decideMember, decideRoster, type ShiftAssignment } from "./engine";
import { publishEvents, type PublishResult } from "./publish";
import { appendEvent, type NewAuditEvent } from "./audit";
import { CREDENTIALS, SITES, WORKERS, TODAY, SEED_AUDIT } from "./seed";
import type {
  Action,
  AuditEvent,
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

export type { PublishResult } from "./publish";

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
  /**
   * Write the publish outcome (clean OR blocked attempt) to the chain.
   *
   * Resolves false when the chain refused it, so a screen does not tell an
   * operator the refusal was recorded when it was not.
   */
  recordPublish: (siteId: string, result: PublishResult, actor?: string) => Promise<boolean>;
  revokeCredential: (credId: string, actor?: string) => void;
  /** append any consequential event from a module (e.g. a break sent under cl 16). */
  recordEvent: (ev: NewAuditEvent) => void;
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
    void (async () => {
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
  const append = useCallback(
    async (ev: NewAuditEvent): Promise<boolean> => {
      if (!durable) {
        setAuditLog((log) => appendEvent(log, ev));
        return true;
      }
      try {
        const res = await fetch("/api/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...ev, clientRef: crypto.randomUUID() }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { event } = (await res.json()) as { event: AuditEvent };
        fold([event]);
        return true;
      } catch {
        // the server refused or is unreachable. Recording locally would put
        // an event in the log that no chain contains, so the log stays as it
        // is and the next read reconciles from the server.
        return false;
      }
    },
    [durable, fold],
  );

  const record = useCallback((ev: NewAuditEvent) => { void append(ev); }, [append]);

  /**
   * Append several events as one act, in order.
   *
   * Sequential and awaited rather than fired together. The server assigns seq
   * in arrival order, so posting a receipt's events in parallel would let the
   * summary land before the reasons it summarises — and the chain records the
   * order it received, not the order intended.
   *
   * Stops at the first refusal. Everything after it belongs to an act that did
   * not complete, and since the summary is written last, a stopped run leaves
   * reasons without a conclusion rather than a conclusion without reasons.
   */
  const recordAll = useCallback(
    async (evs: NewAuditEvent[]): Promise<boolean> => {
      for (const ev of evs) {
        if (!(await append(ev))) return false;
      }
      return true;
    },
    [append],
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

  /**
   * Write what a publish attempt decided.
   *
   * Returns whether the chain took it, so a caller that told the operator the
   * attempt was recorded can find out it was not. This used to build the
   * events inside a setAuditLog() updater and append them locally, which meant
   * a blocked publish existed in one browser tab until it was reloaded —
   * underneath a modal reading "This attempt has been written to the audit
   * log." See lib/idara/publish.ts.
   */
  const recordPublish = useCallback(
    (siteId: string, result: PublishResult, actor = "Emma Taylor"): Promise<boolean> => {
      const site = siteIndex.get(siteId);
      return recordAll(publishEvents(site?.name ?? siteId, siteId, result, actor, TODAY));
    },
    [siteIndex, recordAll],
  );

  /* The append is deliberately outside setCredentials().

     It used to run inside one. A state updater is a function React is free to
     call more than once — StrictMode does so deliberately in development to
     surface impure ones — so a POST in there is a request that may be sent
     twice, and each carries a freshly minted clientRef, which is the one thing
     the idempotency key cannot collapse. The updater was only reading the list
     to find the credential, which it can do outside. */
  const revokeCredential = useCallback(
    (credId: string, actor = "Emma Taylor") => {
      const target = credentials.find((c) => c.id === credId);
      if (!target) return;
      record({
        type: "credential.revoked",
        at: TODAY,
        actor,
        subject: target.subject,
        summary: `${target.type} revoked`,
        data: { credId, type: target.type },
      });
      setCredentials((list) => list.map((c) => (c.id === credId ? { ...c, status: "revoked" } : c)));
    },
    [credentials, record],
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
