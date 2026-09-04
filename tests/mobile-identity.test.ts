import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { currentPerson, setPerson, clearPerson } from "../lib/mobile/identity";

/* ============================================================
   Device identity.

   The point of this module is that a break decision names a person
   rather than the string "Person". So the cases that matter are
   the ones where it might quietly fail to: no storage, corrupt
   storage, a half-written record. Each of those must read as signed
   out — an actor with no did would reach the chain unusable, and the
   chain is append-only, so a bad actor value is permanent.
   ============================================================ */

const KEY = "covers.supervisor";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: memoryStorage() });
});
afterEach(() => vi.unstubAllGlobals());

describe("signing in", () => {
  it("remembers the person across reads", () => {
    setPerson({ did: "did:web:idara.app:w:leanne-vidal", name: "Leanne Vidal", role: "Duty Manager" });
    expect(currentPerson()).toEqual({
      did: "did:web:idara.app:w:leanne-vidal",
      name: "Leanne Vidal",
      role: "Duty Manager",
    });
  });

  it("reads as signed out before anyone picks", () => {
    expect(currentPerson()).toBeNull();
  });

  it("forgets on sign out", () => {
    setPerson({ did: "d", name: "N", role: "R" });
    clearPerson();
    expect(currentPerson()).toBeNull();
  });
});

describe("refusing to produce an unusable actor", () => {
  it("treats corrupt storage as signed out rather than throwing", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(currentPerson()).toBeNull();
  });

  it("rejects a record with no did — it would land in the chain unusable", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ name: "Leanne Vidal", role: "Duty Manager" }));
    expect(currentPerson()).toBeNull();
  });

  it("rejects a record with no name", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ did: "did:web:x" }));
    expect(currentPerson()).toBeNull();
  });

  it("tolerates a missing role, which is cosmetic", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ did: "did:web:x", name: "Someone" }));
    expect(currentPerson()).toEqual({ did: "did:web:x", name: "Someone", role: "" });
  });
});

describe("on the server", () => {
  it("reads as signed out rather than exploding during SSR", () => {
    vi.unstubAllGlobals();
    // no window at all — this runs during render on the server
    expect(currentPerson()).toBeNull();
  });
});

describe("when storage is unavailable", () => {
  it("does not throw if writing is blocked, as in private mode", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error("QuotaExceededError"); },
        removeItem: () => { throw new Error("blocked"); },
      } as unknown as Storage,
    });
    expect(() => setPerson({ did: "d", name: "N", role: "R" })).not.toThrow();
    expect(() => clearPerson()).not.toThrow();
  });
});
