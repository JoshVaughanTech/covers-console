/* ============================================================
   Which time clock the app is reading.

   Three states, and the third is the one worth a test. Nothing set
   is the demo and is safe. Everything set is Connecteam. HALF set
   is somebody mid-way through wiring it up, and the tempting answer
   — treat it as unconfigured and serve the seed — answers "somebody
   asked and got it wrong" as though it were "nobody asked".

   That is the same shape as the pack vault's key, found in review on
   the same afternoon, and it is worse here than it first looks:
   hour confirmation reads this. A half-configured clock would settle
   SEEDED hours as a real worker's, write them to the chain, and
   invoice the venue for them — and every check of it would pass,
   because seeded sessions are perfectly well-formed.
   ============================================================ */
import { describe, it, expect, afterEach } from "vitest";
import { clockConfigured, completedSessions } from "../lib/integrations/clock";

const VARS = [
  "CONNECTEAM_TIME_CLOCK_ID",
  "CONNECTEAM_API_KEY",
  "CONNECTEAM_CLIENT_ID",
  "CONNECTEAM_CLIENT_SECRET",
] as const;

const before = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS) {
    if (before[v] === undefined) delete process.env[v];
    else process.env[v] = before[v] as string;
  }
});

const clear = () => VARS.forEach((v) => delete process.env[v]);

describe("nothing configured is the demo", () => {
  it("reports not-live rather than throwing", () => {
    clear();
    expect(clockConfigured()).toBe(false);
  });

  /* The flag has to be on the result. A caller cannot be expected to re-derive
     where its sessions came from, and one that assumed would bill somebody. */
  it("says on the result that the sessions are seeded", async () => {
    clear();
    const read = await completedSessions(Math.floor(Date.now() / 1000));
    expect(read.live).toBe(false);
    expect(read.sessions.every((s) => s.clockOut != null)).toBe(true);
  });
});

describe("fully configured is the clock", () => {
  it("accepts an API key", () => {
    clear();
    process.env.CONNECTEAM_TIME_CLOCK_ID = "tc-1";
    process.env.CONNECTEAM_API_KEY = "k";
    expect(clockConfigured()).toBe(true);
  });

  it("accepts an OAuth pair", () => {
    clear();
    process.env.CONNECTEAM_TIME_CLOCK_ID = "tc-1";
    process.env.CONNECTEAM_CLIENT_ID = "id";
    process.env.CONNECTEAM_CLIENT_SECRET = "secret";
    expect(clockConfigured()).toBe(true);
  });
});

describe("half configured is refused", () => {
  it("refuses a clock id with no credentials", () => {
    clear();
    process.env.CONNECTEAM_TIME_CLOCK_ID = "tc-1";
    expect(() => clockConfigured()).toThrow(/half-configured/);
  });

  it("refuses credentials with no clock id", () => {
    clear();
    process.env.CONNECTEAM_API_KEY = "k";
    expect(() => clockConfigured()).toThrow(/CONNECTEAM_TIME_CLOCK_ID/);
  });

  /* A client id without its secret is not credentials. It is the most likely
     half-paste of the three, and the one that most looks configured. */
  it("refuses a client id with no secret", () => {
    clear();
    process.env.CONNECTEAM_TIME_CLOCK_ID = "tc-1";
    process.env.CONNECTEAM_CLIENT_ID = "id";
    expect(() => clockConfigured()).toThrow(/half-configured/);
  });

  it("names what is missing rather than only that something is", () => {
    clear();
    process.env.CONNECTEAM_CLIENT_ID = "id";
    process.env.CONNECTEAM_CLIENT_SECRET = "secret";
    expect(() => clockConfigured()).toThrow(/CONNECTEAM_TIME_CLOCK_ID/);
  });

  /* And it reaches the reader, rather than being a check nothing calls. */
  it("stops a half-configured read from returning seeded sessions", async () => {
    clear();
    process.env.CONNECTEAM_TIME_CLOCK_ID = "tc-1";
    await expect(completedSessions(Math.floor(Date.now() / 1000))).rejects.toThrow(
      /half-configured/,
    );
  });
});
