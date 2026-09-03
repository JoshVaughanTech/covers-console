/* ============================================================
   GET /api/events/stream — server-sent events.

   One-way server→client, so SSE rather than WebSockets: it survives
   proxies and reconnects natively, and its Last-Event-ID header maps
   exactly onto the store's `since` cursor. A client that drops mid
   service resumes without a bespoke catch-up protocol.
   ============================================================ */
import { eventStore } from "@/lib/store/events";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";

export async function GET(req: Request) {
  const store = eventStore();
  const lastId = req.headers.get("last-event-id");
  const since = Number(lastId ?? new URL(req.url).searchParams.get("since") ?? -1);

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: { seq: number }) =>
        controller.enqueue(encoder.encode(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`));

      // replay what this client missed before going live, so a reconnect
      // never leaves a hole between the cursor and the first live event
      for (const e of store.since(ORG, Number.isFinite(since) ? since : -1)) send(e);

      unsubscribe = store.subscribe(ORG, send);
      // comment frames keep intermediaries from closing an idle connection
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 25_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // proxies that buffer would defeat the point
      "x-accel-buffering": "no",
    },
  });
}
