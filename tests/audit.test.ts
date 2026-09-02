import { describe, it, expect } from "vitest";
import {
  appendEvent,
  verifyChain,
  shortHash,
  GENESIS_HASH,
  type NewAuditEvent,
} from "../lib/idara/audit";
import type { AuditEvent } from "../lib/idara/types";

const ev = (summary: string, over: Partial<NewAuditEvent> = {}): NewAuditEvent => ({
  type: "decision",
  at: "2024-05-16",
  actor: "Emma Taylor",
  summary,
  ...over,
});

const build = (n: number): AuditEvent[] =>
  Array.from({ length: n }, (_, i) => ev(`event ${i}`)).reduce(
    (log, e) => appendEvent(log, e),
    [] as AuditEvent[],
  );

describe("appendEvent", () => {
  it("anchors the first event to the genesis hash", () => {
    const [first] = appendEvent([], ev("first"));
    expect(first.seq).toBe(0);
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(GENESIS_HASH).toMatch(/^0{64}$/);
  });

  it("links each event to its predecessor and increments seq", () => {
    const log = build(4);
    expect(log.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < log.length; i++) {
      expect(log[i].prevHash).toBe(log[i - 1].hash);
    }
  });

  it("does not mutate the input log (append-only, immutably)", () => {
    const log = build(2);
    const snapshot = JSON.stringify(log);
    const next = appendEvent(log, ev("third"));
    expect(log).toHaveLength(2);
    expect(JSON.stringify(log)).toBe(snapshot);
    expect(next).toHaveLength(3);
  });

  it("produces SHA-256-width hashes", () => {
    for (const e of build(3)) expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives different hashes to otherwise-identical events at different positions", () => {
    const log = build(3).concat();
    const a = appendEvent(log, ev("same text"));
    const b = appendEvent(a, ev("same text"));
    expect(b[3].hash).not.toBe(b[4].hash);
  });
});

describe("verifyChain", () => {
  it("accepts an untouched chain", () => {
    expect(verifyChain(build(5))).toEqual({ ok: true, brokenAt: null });
  });

  it("accepts an empty log", () => {
    expect(verifyChain([])).toEqual({ ok: true, brokenAt: null });
  });

  it("survives a JSON round-trip (canonical encoding, not key order)", () => {
    const log = build(5);
    const reloaded: AuditEvent[] = JSON.parse(JSON.stringify(log));
    expect(verifyChain(reloaded)).toEqual({ ok: true, brokenAt: null });
  });

  it("survives a round-trip that reorders object keys", () => {
    const log = build(3);
    // simulates a store/transport that re-serialises members in another order
    const shuffled = log.map((e) => {
      const entries = Object.entries(e).reverse();
      return Object.fromEntries(entries) as unknown as AuditEvent;
    });
    expect(verifyChain(shuffled)).toEqual({ ok: true, brokenAt: null });
  });

  it("detects an edited summary", () => {
    const log = build(5);
    log[2] = { ...log[2], summary: "quietly rewritten" };
    expect(verifyChain(log)).toEqual({ ok: false, brokenAt: 2 });
  });

  it("detects an edited nested data payload", () => {
    const log = build(4);
    log[1] = { ...log[1], data: { blocked: 0 } };
    expect(verifyChain(log)).toEqual({ ok: false, brokenAt: 1 });
  });

  it("detects a changed actor", () => {
    const log = build(3);
    log[0] = { ...log[0], actor: "Someone Else" };
    expect(verifyChain(log)).toEqual({ ok: false, brokenAt: 0 });
  });

  it("detects a deleted event", () => {
    const log = build(5);
    const withHole = [...log.slice(0, 2), ...log.slice(3)];
    // event #3 no longer follows the hash it claims to
    expect(verifyChain(withHole)).toEqual({ ok: false, brokenAt: 3 });
  });

  it("detects reordered events", () => {
    const log = build(5);
    const swapped = [log[0], log[1], log[3], log[2], log[4]];
    expect(verifyChain(swapped).ok).toBe(false);
  });

  it("detects a forged hash that does not match its own body", () => {
    const log = build(3);
    log[1] = { ...log[1], hash: "f".repeat(64) };
    expect(verifyChain(log)).toEqual({ ok: false, brokenAt: 1 });
  });

  it("cannot be repaired by rewriting one event's hash alone", () => {
    // the tamperer edits event 2 and recomputes only its own hash;
    // event 3 still points at the old hash, so the break just moves.
    const log = build(5);
    const tampered = appendEvent(log.slice(0, 2), ev("rewritten"));
    const forged = [...tampered, ...log.slice(3)];
    expect(verifyChain(forged).ok).toBe(false);
  });

  it("reports the first break when several events are altered", () => {
    const log = build(6);
    log[4] = { ...log[4], summary: "later edit" };
    log[2] = { ...log[2], summary: "earlier edit" };
    expect(verifyChain(log).brokenAt).toBe(2);
  });
});

describe("shortHash", () => {
  it("truncates for display without altering the stored value", () => {
    const [e] = appendEvent([], ev("x"));
    expect(shortHash(e.hash)).toHaveLength(12);
    expect(e.hash.startsWith(shortHash(e.hash))).toBe(true);
    expect(e.hash).toHaveLength(64);
  });
});
