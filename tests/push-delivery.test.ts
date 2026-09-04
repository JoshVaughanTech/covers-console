import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PushStore } from "../lib/store/push";
import { sendPush } from "../lib/push/send";
import { generateVapidKeys } from "../lib/push/vapid";

/* ============================================================
   Delivery, as distinct from encryption.

   The crypto is checked against its RFCs next door. This is about
   what happens on a real network: devices that no longer exist,
   services having a bad afternoon, and a shared phone changing
   hands. Every one of these fails quietly if it is wrong — the push
   returns a status nobody looks at, and the notification simply
   never appears.

   The one that matters most is the difference between "gone" and
   "failing today". Deleting on the wrong status throws away a
   working subscription because Firefox was slow; keeping a dead one
   means every posting retries it forever and counts a device that
   stopped existing as somebody who was notified. That count is what
   a manager uses to decide a shift is unfillable.
   ============================================================ */

const ORG = "org-test";
const AT = "2026-09-04T09:00:00.000Z";
const KEYS = { ...generateVapidKeys(), subject: "mailto:ops@example.test" };

const sub = (over: Partial<{ did: string; endpoint: string; p256dh: string; auth: string }> = {}) => ({
  did: "did:web:idara.app:w:darie-roberts",
  endpoint: "https://push.example.test/sub/abc",
  // a real 65-byte uncompressed point, so encryption gets far enough to send
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  ...over,
});

let store: PushStore;
beforeEach(() => { store = new PushStore(":memory:"); });
afterEach(() => { store.close(); vi.restoreAllMocks(); });

describe("remembering a device", () => {
  it("keeps one row per device, not per person", () => {
    store.save(ORG, sub(), AT);
    store.save(ORG, sub({ endpoint: "https://push.example.test/sub/tablet" }), AT);
    // a phone and a tablet should both light up
    expect(store.countFor(ORG, sub().did)).toBe(2);
  });

  it("replaces the keys when a browser re-subscribes on the same endpoint", () => {
    store.save(ORG, sub(), AT);
    store.save(ORG, sub({ auth: "ZZZZZZZZZZZZZZZZZZZZZZ" }), AT);

    expect(store.countFor(ORG, sub().did)).toBe(1);
    /* Keeping the old keys would encrypt to something the device can no
       longer read: a push that succeeds and silently never appears. */
    expect(store.forWorker(ORG, sub().did)[0].auth).toBe("ZZZZZZZZZZZZZZZZZZZZZZ");
  });

  it("moves a device to whoever signed in on it last", () => {
    const mitch = "did:web:idara.app:w:mitch-egan";
    store.save(ORG, sub(), AT);
    store.save(ORG, sub({ did: mitch }), AT);

    // a shared phone must stop showing the previous person's shifts
    expect(store.countFor(ORG, sub().did)).toBe(0);
    expect(store.countFor(ORG, mitch)).toBe(1);
  });

  it("forgets one on request", () => {
    store.save(ORG, sub(), AT);
    expect(store.remove(ORG, sub().endpoint)).toBe(true);
    expect(store.remove(ORG, sub().endpoint)).toBe(false);
    expect(store.countFor(ORG, sub().did)).toBe(0);
  });
});

describe("sending one", () => {
  const mockFetch = (status: number, body = "") =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status }) as unknown as Response,
    );

  it("posts encrypted bytes with the headers a push service requires", async () => {
    const spy = mockFetch(201);
    const r = await sendPush(sub(), JSON.stringify({ title: "Bartender" }), KEYS);

    expect(r.ok).toBe(true);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(sub().endpoint);

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    // a shift alert arriving next morning is worse than none: the shift is
    // gone and the notification has become a small lie
    expect(Number(headers.TTL)).toBeLessThanOrEqual(4 * 3600);

    // and the body is ciphertext, not the payload
    expect(Buffer.from(init.body as Uint8Array).toString("utf8")).not.toContain("Bartender");
  });

  it("reports a dead subscription as gone, so the caller can prune it", async () => {
    for (const status of [404, 410]) {
      mockFetch(status);
      const r = await sendPush(sub(), "{}", KEYS);
      expect(r).toMatchObject({ ok: false, gone: true, status });
      vi.restoreAllMocks();
    }
  });

  it("does not call a bad afternoon a dead device", async () => {
    for (const status of [429, 500, 503]) {
      mockFetch(status, "slow down");
      const r = await sendPush(sub(), "{}", KEYS);
      // deleting on these throws away a working subscription
      expect(r).toMatchObject({ ok: false, gone: false });
      vi.restoreAllMocks();
    }
  });

  it("survives the push service being unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await sendPush(sub(), "{}", KEYS);
    expect(r).toMatchObject({ ok: false, gone: false, status: 0 });
  });

  it("refuses a stored key that cannot be encrypted to, without calling out", async () => {
    const spy = mockFetch(201);
    const r = await sendPush(sub({ p256dh: "c2hvcnQ" }), "{}", KEYS);

    expect(r.ok).toBe(false);
    // no point troubling a push service with something we know is malformed,
    // and it is our stored row at fault rather than their service
    expect(spy).not.toHaveBeenCalled();
  });
});
