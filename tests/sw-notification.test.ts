import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ============================================================
   Where tapping a notification actually lands you.

   public/sw.js is the one file in this repo that no build touches
   and no page imports — it is fetched by URL and runs when the app
   is shut. Nothing else would notice if it broke, and the failure
   is silent: the notification still arrives, still opens something,
   and quietly opens the wrong thing.

   That is not hypothetical here. The push payload has carried
   `postingId` since push was built and this handler discarded it,
   because until /m/shifts/[id] existed there was nowhere to send
   it. So a shift alert woke a phone and handed over a board to
   search — worst exactly when it matters most, on a busy board.

   Run rather than read: the handler is evaluated against a fake
   `self` and invoked, so these assert what it does and not what it
   looks like.
   ============================================================ */

type Handler = (event: unknown) => void;

interface FakeClient {
  url: string;
  focus: () => Promise<FakeClient>;
  navigate?: (u: string) => Promise<FakeClient | null>;
  navigatedTo?: string;
  focused?: boolean;
}

let handlers: Record<string, Handler>;
let opened: string[];
let clients: FakeClient[];

/** Load sw.js against a stubbed worker global and return its listeners. */
function loadWorker() {
  handlers = {};
  opened = [];
  clients = [];

  const self = {
    addEventListener: (name: string, fn: Handler) => {
      handlers[name] = fn;
    },
    registration: { showNotification: () => Promise.resolve() },
    clients: {
      matchAll: () => Promise.resolve(clients),
      openWindow: (u: string) => {
        opened.push(u);
        return Promise.resolve(null);
      },
    },
  };

  const src = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function("self", src)(self);
  return handlers;
}

/** A notification tap, with whatever the push put in `data`. */
async function tap(data: unknown) {
  const waits: Promise<unknown>[] = [];
  let closed = false;
  handlers.notificationclick({
    notification: { close: () => (closed = true), data },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  await Promise.all(waits);
  return { closed };
}

const client = (url: string, canNavigate = true): FakeClient => {
  const c: FakeClient = {
    url,
    focus: async () => {
      c.focused = true;
      return c;
    },
  };
  if (canNavigate) {
    c.navigate = async (u: string) => {
      c.navigatedTo = u;
      return c;
    };
  }
  return c;
};

beforeAll(() => loadWorker());

/* Per test, not per file. openWindow() appends, so without this the first
   assertion to pass leaves its URL sitting in the array for the next one to
   find — which is how the traversal case came back green with the previous
   test's id in it. */
beforeEach(() => {
  opened = [];
  clients = [];
});

describe("tapping a shift notification", () => {
  it("opens the shift it was about, not the board", async () => {
    /* The whole point. Before this, every notification opened /m/shifts and
       the id in the payload was dropped on the floor. */
    await tap({ postingId: "sp-2041-bar" });
    expect(opened).toEqual(["/m/shifts/sp-2041-bar"]);
  });

  it("navigates an app tab that is already open rather than stranding it on the board", async () => {
    /* Focusing alone was the old behaviour and would now be a subtler version
       of the same bug: the right tab, still showing the wrong page. */
    const c = client("http://x/m/shifts");
    clients = [c];
    await tap({ postingId: "sp-2038-wait" });

    expect(c.navigatedTo).toBe("/m/shifts/sp-2038-wait");
    expect(c.focused).toBe(true);
    expect(opened).toEqual([]); // no second copy of the app
  });

  it("still focuses when the tab refuses to navigate", async () => {
    /* navigate() rejects for a client this worker does not control. Landing
       them on the app is worse than the shift and much better than nothing. */
    const c = client("http://x/m/shifts");
    c.navigate = () => Promise.reject(new Error("not controlled"));
    clients = [c];
    await tap({ postingId: "sp-2041-bar" });

    expect(c.focused).toBe(true);
    expect(opened).toEqual([]);
  });

  it("falls back to the board when the push carried no id", async () => {
    // a notification that opens nothing is worse than one that opens the board
    clients = [];
    await tap({ postingId: null });
    expect(opened).toEqual(["/m/shifts"]);
  });

  it("survives a notification with no data at all", async () => {
    clients = [];
    await tap(undefined);
    expect(opened).toEqual(["/m/shifts"]);
  });

  it("escapes the id rather than pasting it into a path", async () => {
    clients = [];
    await tap({ postingId: "sp/../../evil?x=1" });
    expect(opened[0]).toBe("/m/shifts/sp%2F..%2F..%2Fevil%3Fx%3D1");
    // the traversal cannot survive as path segments
    expect(opened[0]).not.toContain("/../");
  });

  it("closes the notification it acted on", async () => {
    clients = [];
    const { closed } = await tap({ postingId: "sp-2041-bar" });
    expect(closed).toBe(true);
  });
});

describe("the push that produced it", () => {
  it("keeps the posting id on the notification for the tap to use", async () => {
    /* The two halves have to agree: push writes `data.postingId` and the click
       handler reads it. They are in one file and were still out of step for
       as long as push has existed. */
    let shown: { title: string; opts: Record<string, unknown> } | null = null;
    handlers = {};
    const self = {
      addEventListener: (n: string, fn: Handler) => (handlers[n] = fn),
      registration: {
        showNotification: (title: string, opts: Record<string, unknown>) => {
          shown = { title, opts };
          return Promise.resolve();
        },
      },
      clients: { matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve(null) },
    };
    const src = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    new Function("self", src)(self);

    const waits: Promise<unknown>[] = [];
    handlers.push({
      data: { json: () => ({ title: "Bartender · Sat, 18 May", body: "…", postingId: "sp-2041-bar" }) },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);

    expect(shown!.opts.data).toEqual({ postingId: "sp-2041-bar" });
    // one row per shift on the lock screen, not one per push
    expect(shown!.opts.tag).toBe("shift-sp-2041-bar");
  });
});
