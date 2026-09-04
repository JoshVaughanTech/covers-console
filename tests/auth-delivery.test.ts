import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sinkFromEnv, FileSink, InlineSink, NoSink } from "../lib/auth/delivery";

/* ============================================================
   Which channel a deployment gets.

   Small surface, disproportionate consequence: the inline sink
   returns the code in the response body, so choosing it by accident
   hands a live sign-in code to anyone who can reach the server.

   These exist because the first version of this function read
   `NODE_ENV !== "production"` — inferring "safe to expose codes"
   from the absence of a danger marker, when absence is the default
   state of an unconfigured environment. The tests then pinned
   "production" and "development" and never asked what an unset
   variable did, which is how it passed.

   So the cases below are mostly the ones nobody sets on purpose.
   ============================================================ */

afterEach(() => vi.unstubAllEnvs());

const clearChannel = () => {
  vi.stubEnv("AUTH_CODES_DIR", "");
  vi.stubEnv("AUTH_CODES_INLINE", "");
};

describe("environments nobody configured", () => {
  it("refuses when NODE_ENV is unset", () => {
    clearChannel();
    vi.stubEnv("NODE_ENV", undefined as unknown as string);
    // unset is the class; staging is one example of it
    expect(sinkFromEnv()).toBeInstanceOf(NoSink);
    expect(sinkFromEnv().configured).toBe(false);
  });

  it("refuses on staging, where the real names live", () => {
    clearChannel();
    vi.stubEnv("NODE_ENV", "staging");
    expect(sinkFromEnv()).toBeInstanceOf(NoSink);
  });

  it("refuses on anything misspelled or invented", () => {
    clearChannel();
    for (const env of ["preview", "prod", "Production", "qa", ""]) {
      vi.stubEnv("NODE_ENV", env);
      expect(sinkFromEnv(), `NODE_ENV=${env}`).toBeInstanceOf(NoSink);
    }
  });
});

describe("environments that say what they are", () => {
  it("allows inline in development and test only", () => {
    clearChannel();
    for (const env of ["development", "test"]) {
      vi.stubEnv("NODE_ENV", env);
      expect(sinkFromEnv(), `NODE_ENV=${env}`).toBeInstanceOf(InlineSink);
    }
  });

  it("refuses in production", () => {
    clearChannel();
    vi.stubEnv("NODE_ENV", "production");
    expect(sinkFromEnv()).toBeInstanceOf(NoSink);
  });
});

describe("what an operator asked for", () => {
  it("takes a directory over everything, in any environment", () => {
    vi.stubEnv("AUTH_CODES_DIR", "/tmp/codes");
    for (const env of ["production", "development", "staging"]) {
      vi.stubEnv("NODE_ENV", env);
      expect(sinkFromEnv(), `NODE_ENV=${env}`).toBeInstanceOf(FileSink);
    }
  });

  it("allows inline anywhere when somebody has said so out loud", () => {
    vi.stubEnv("AUTH_CODES_DIR", "");
    vi.stubEnv("AUTH_CODES_INLINE", "1");
    vi.stubEnv("NODE_ENV", "production");
    // explicit, and it is the saying-so that makes it acceptable
    expect(sinkFromEnv()).toBeInstanceOf(InlineSink);
  });

  it("does not treat a vague truthy value as saying so", () => {
    vi.stubEnv("AUTH_CODES_DIR", "");
    vi.stubEnv("NODE_ENV", "production");
    for (const v of ["true", "yes", "0", "on"]) {
      vi.stubEnv("AUTH_CODES_INLINE", v);
      expect(sinkFromEnv(), `AUTH_CODES_INLINE=${v}`).toBeInstanceOf(NoSink);
    }
  });
});

describe("a sink that cannot deliver", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "covers-sink-")); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("says so before anyone mints against it", () => {
    expect(new NoSink().configured).toBe(false);
    expect(new InlineSink().configured).toBe(true);
    expect(new FileSink(join(tmp, "codes")).configured).toBe(true);
  });

  it("refuses a directory that is actually a file", () => {
    /* The earlier version of this test asserted configured was true for an
       arbitrary path. That did not merely miss this — it pinned the wrong
       behaviour as the specification, so a future reader would take "always
       true" as intended. A path that is a file is an ordinary typo, and the
       shape of a volume that did not mount. */
    const notADir = join(tmp, "oops");
    writeFileSync(notADir, "i am a file", "utf8");
    const sink = new FileSink(notADir);

    expect(sink.configured).toBe(false);
    // and it says why, because somebody has to fix the path they mistyped
    expect(sink.describe()).toMatch(/unusable/);
  });

  it("creates a directory that does not exist yet rather than refusing", () => {
    // a fresh deployment has not made the folder; that is not a misconfiguration
    expect(new FileSink(join(tmp, "deep", "nested", "codes")).configured).toBe(true);
  });

  it("throws with the fix in the message rather than a bare failure", async () => {
    await expect(new NoSink().deliver()).rejects.toThrow(/AUTH_CODES_DIR/);
  });
});

describe("a directory that looks set and is not", () => {
  it("falls through to the environment rule when AUTH_CODES_DIR is empty", () => {
    /* Same family as a vague truthy AUTH_CODES_INLINE: a value that looks
       configured but is not. The truthiness check catches it, and this says so
       out loud rather than leaving it to be inferred from the other cases. */
    vi.stubEnv("AUTH_CODES_DIR", "");
    vi.stubEnv("AUTH_CODES_INLINE", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(sinkFromEnv()).toBeInstanceOf(NoSink);
  });

  it("refuses rather than falling back when the directory is unusable", () => {
    /* Not the same thing at all. An empty variable means nobody asked for a
       file; an unusable path means somebody did and got it wrong, and quietly
       falling back to the inline sink would answer a misconfiguration by
       exposing codes — the opposite of what they asked for. */
    const tmp = mkdtempSync(join(tmpdir(), "covers-sink-"));
    const notADir = join(tmp, "oops");
    writeFileSync(notADir, "i am a file", "utf8");
    try {
      vi.stubEnv("AUTH_CODES_DIR", notADir);
      vi.stubEnv("NODE_ENV", "development");
      const sink = sinkFromEnv();
      expect(sink).toBeInstanceOf(FileSink);
      expect(sink.configured).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
