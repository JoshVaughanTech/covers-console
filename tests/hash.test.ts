import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex, canonicalJson } from "../lib/idara/hash";

/** Independent oracle — Node's OpenSSL-backed SHA-256. */
const ref = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("sha256Hex", () => {
  it("matches published NIST/RFC vectors", async () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("agrees with node:crypto across the message-padding boundaries", async () => {
    // 55/56 straddle the point where the length no longer fits in the
    // first block; 63/64/65 straddle the block size itself.
    for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const input = "a".repeat(n);
      expect(sha256Hex(input), `length ${n}`).toBe(ref(input));
    }
  });

  it("is UTF-8 aware, not UTF-16 code-unit based", async () => {
    for (const s of ["é", "日本語", "🍸 venue", "Liam O'Brien — RSA"]) {
      expect(sha256Hex(s), s).toBe(ref(s));
    }
    expect(sha256Hex("é")).not.toBe(sha256Hex("e"));
  });

  it("agrees with node:crypto on realistic audit payloads", async () => {
    const payload = canonicalJson({
      seq: 7,
      type: "roster.published",
      actor: "Emma Taylor",
      data: { siteId: "s-brightwater", eligible: 6, published: true },
    });
    expect(sha256Hex(payload)).toBe(ref(payload));
  });

  it("always returns 64 lowercase hex chars", async () => {
    for (const s of ["", "abc", "a".repeat(200)]) {
      expect(sha256Hex(s)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("avalanches — a one-character change alters the digest", async () => {
    expect(sha256Hex("Roster published")).not.toBe(sha256Hex("Roster publishee"));
  });
});

describe("canonicalJson", () => {
  it("is independent of key insertion order", async () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts nested objects too", async () => {
    const x = { outer: { z: 1, a: { d: 4, c: 3 } } };
    const y = { outer: { a: { c: 3, d: 4 }, z: 1 } };
    expect(canonicalJson(x)).toBe(canonicalJson(y));
  });

  it("preserves array order (arrays are sequences, not sets)", async () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("drops undefined members, matching a JSON round-trip", async () => {
    const withUndef = { a: 1, subject: undefined };
    const roundTripped = JSON.parse(JSON.stringify(withUndef));
    expect(canonicalJson(withUndef)).toBe(canonicalJson(roundTripped));
    expect(canonicalJson(withUndef)).toBe('{"a":1}');
  });

  it("handles primitives and null", async () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(true)).toBe("true");
  });
});
