import { describe, it, expect, vi, afterEach } from "vitest";
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
  it("says so before anyone mints against it", () => {
    expect(new NoSink().configured).toBe(false);
    expect(new InlineSink().configured).toBe(true);
    expect(new FileSink("/tmp/x").configured).toBe(true);
  });

  it("throws with the fix in the message rather than a bare failure", async () => {
    await expect(new NoSink().deliver()).rejects.toThrow(/AUTH_CODES_DIR/);
  });
});
