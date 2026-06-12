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
  type ReactNode,
} from "react";
import { LocalCredentialVerifier } from "./verifier";
import { decide, summarise } from "./engine";
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

export interface PublishResult {
  decisions: Decision[];
  eligible: Decision[];
  blocked: Decision[];
  warnings: Decision[];
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
  decideFor: (did: DID, action: Action, siteId: string) => Decision | null;
  /** pure pass over a roster — eligible / blocked / warnings. No audit. */
  evaluateRoster: (siteId: string, dids: DID[]) => PublishResult;
  /** write the publish outcome (clean OR blocked attempt) to the audit log. */
  recordPublish: (siteId: string, result: PublishResult, actor?: string) => void;
  revokeCredential: (credId: string, actor?: string) => void;
}

const IdaraContext = createContext<IdaraState | null>(null);

export function IdaraProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credential[]>(CREDENTIALS);
  const [auditLog, setAuditLog] = useState<AuditEvent[]>(SEED_AUDIT);

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

  const record = useCallback((ev: NewAuditEvent) => {
    setAuditLog((log) => appendEvent(log, ev));
  }, []);

  const decideFor = useCallback(
    (did: DID, action: Action, siteId: string): Decision | null => {
      const person = workerIndex.get(did);
      const site = siteIndex.get(siteId);
      if (!person || !site) return null;
      return decide({
        person,
        credentials: credentials.filter((c) => c.subject === did),
        action,
        site,
        at: TODAY,
        verifier,
      });
    },
    [workerIndex, siteIndex, credentials, verifier],
  );

  const evaluateRoster = useCallback(
    (siteId: string, dids: DID[]): PublishResult => {
      const decisions = dids
        .map((did) => decideFor(did, "be_rostered", siteId))
        .filter((d): d is Decision => d !== null);
      const eligible = decisions.filter((d) => d.allowed);
      const blocked = decisions.filter((d) => !d.allowed);
      const warnings = decisions.filter((d) => d.allowed && d.warnings > 0);
      return { decisions, eligible, blocked, warnings, published: blocked.length === 0 };
    },
    [decideFor],
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
          // …then the blocked publish attempt itself
          next = appendEvent(next, {
            type: "roster.published",
            at: TODAY,
            actor,
            summary: `Publish blocked for ${site?.name ?? siteId} — ${result.blocked.length} ineligible worker${result.blocked.length === 1 ? "" : "s"}`,
            data: { siteId, attempted: result.decisions.length, blocked: result.blocked.length, published: false },
          });
        } else {
          next = appendEvent(next, {
            type: "roster.published",
            at: TODAY,
            actor,
            summary: `Roster published for ${site?.name ?? siteId} — ${result.eligible.length} workers, all eligible`,
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
    }),
    [credentials, auditLog, credentialsOf, workerIndex, siteIndex, decideFor, evaluateRoster, recordPublish, revokeCredential],
  );

  return <IdaraContext.Provider value={value}>{children}</IdaraContext.Provider>;
}

export function useIdara(): IdaraState {
  const ctx = useContext(IdaraContext);
  if (!ctx) throw new Error("useIdara must be used within an IdaraProvider");
  return ctx;
}
