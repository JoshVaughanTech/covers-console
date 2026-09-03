import { describe, it, expect, vi, afterEach } from "vitest";
import { ConnecteamClient, ConnecteamScopeError } from "../lib/integrations/connecteam";

/* ============================================================
   Auth and partial-scope behaviour.

   A migrating customer will run with some scopes granted and others
   not, for weeks. The board must keep working on the scopes it has:
   punches are the compliance data, and names are a label on top of
   them. So a users.read refusal degrades, and anything else throws.
   ============================================================ */

const TOKEN_URL = "https://api.connecteam.com/oauth/v1/token";

/** A JWT-shaped token so expiry parsing has something to read. */
function fakeJwt(secondsLeft = 3600) {
  const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsLeft })).toString("base64url");
  return `header.${claims}.sig`;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("credentials", () => {
  it("refuses to construct with neither an api key nor a client pair", () => {
    expect(() => new ConnecteamClient({ timeClockId: "1" })).toThrow(/apiKey or clientId/);
  });

  it("accepts either shape", () => {
    expect(() => new ConnecteamClient({ timeClockId: "1", apiKey: "k" })).not.toThrow();
    expect(() => new ConnecteamClient({ timeClockId: "1", clientId: "a", clientSecret: "b" })).not.toThrow();
  });
});

describe("OAuth", () => {
  it("exchanges client credentials over Basic, then sends Bearer", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("authorization");
      seen.push({ url, auth });
      if (url === TOKEN_URL) return json({ access_token: fakeJwt(), expires_in: 3600 });
      return json({ data: { manualBreaks: [] } });
    });

    const c = new ConnecteamClient({ timeClockId: "42", clientId: "id", clientSecret: "secret" });
    await c.sessions(1_700_000_000, false).catch(() => {});

    const exchange = seen.find((s) => s.url === TOKEN_URL);
    expect(exchange, "no token exchange happened").toBeTruthy();
    expect(exchange!.auth).toBe("Basic " + Buffer.from("id:secret").toString("base64"));
    // every data call afterwards carries the bearer, not the basic
    for (const s of seen.filter((x) => x.url !== TOKEN_URL)) expect(s.auth).toMatch(/^Bearer /);
  });

  it("mints one token and reuses it across calls", async () => {
    let exchanges = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      if (String(input) === TOKEN_URL) { exchanges++; return json({ access_token: fakeJwt(), expires_in: 3600 }); }
      return json({ data: { manualBreaks: [] } });
    });
    const c = new ConnecteamClient({ timeClockId: "42", clientId: "id", clientSecret: "secret" });
    await c.sessions(1_700_000_000, false).catch(() => {});
    await c.sessions(1_700_000_000, false).catch(() => {});
    expect(exchanges).toBe(1);
  });

  it("sends the api key instead when one is configured, and never exchanges", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      seen.push(String(input));
      expect(new Headers(init?.headers).get("x-api-key")).toBe("legacy-key");
      return json({ data: { manualBreaks: [] } });
    });
    const c = new ConnecteamClient({ timeClockId: "42", apiKey: "legacy-key" });
    await c.sessions(1_700_000_000, false).catch(() => {});
    expect(seen.some((u) => u === TOKEN_URL)).toBe(false);
  });
});

describe("partial scopes", () => {
  const scopeRefusal = (scope: string) =>
    json({ error: `Token missing required scope: ${scope}`, details: null }, 403);

  it("keeps returning punches when users.read is refused", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url === TOKEN_URL) return json({ access_token: fakeJwt(), expires_in: 3600 });
      if (url.includes("/users/v1/users")) return scopeRefusal("users.read");
      if (url.includes("manual-breaks")) return json({ data: { manualBreaks: [] } });
      return json({
        data: {
          timeActivitiesByUsers: [
            { userId: 77, shifts: [{ id: "s1", start: { timestamp: 1_700_000_000 }, end: null }], manualBreaks: [] },
          ],
        },
      });
    });

    const c = new ConnecteamClient({ timeClockId: "42", clientId: "id", clientSecret: "secret" });
    const sessions = await c.sessions(1_700_003_600, false);

    expect(sessions).toHaveLength(1);
    // the punch survives; the name falls back to the id until the scope lands
    expect(sessions[0].name).toBe("User 77");
    expect(sessions[0].clockIn).toBe(1_700_000_000);
  });

  it("still throws when the failure is not a permission", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url === TOKEN_URL) return json({ access_token: fakeJwt(), expires_in: 3600 });
      if (url.includes("/users/v1/users")) return json({ error: "upstream exploded" }, 500);
      return json({ data: {} });
    });
    const c = new ConnecteamClient({ timeClockId: "42", clientId: "id", clientSecret: "secret" });
    await expect(c.sessions(1_700_000_000, false)).rejects.toThrow(/500/);
  });

  it("names the missing scope, so the fix is obvious", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      if (String(input) === TOKEN_URL) return json({ access_token: fakeJwt(), expires_in: 3600 });
      return scopeRefusal("pay_rates.read");
    });
    const c = new ConnecteamClient({ timeClockId: "42", clientId: "id", clientSecret: "secret" });
    const err = await c.sessions(1_700_000_000, false).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ConnecteamScopeError);
    expect((err as ConnecteamScopeError).scope).toBe("pay_rates.read");
    expect(String(err)).toContain("pay_rates.read");
  });
});
