/* ============================================================
   GET /api/events/stream — server-sent events.

   One-way server→client, so SSE rather than WebSockets: it survives
   proxies and reconnects natively, and its Last-Event-ID header maps
   exactly onto the store's `since` cursor. A client that drops mid
   service resumes without a bespoke catch-up protocol.

   Every write goes through one guarded helper. enqueue() throws once
   the stream is closed, and the subscriber runs from a microtask in
   the store, so an unguarded write after disconnect is an *uncaught*
   throw rather than a caught one — and under React Strict Mode the
   client mounts twice, so disconnects happen on every page load in
   development rather than rarely.
   ============================================================ */
import { eventStore } from "@/lib/store/events";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  const store = eventStore();
  const lastId = req.headers.get("last-event-id");
  const since = Number(lastId ?? new URL(req.url).searchParams.get("since") ?? -1);
  const from = Number.isFinite(since) ? since : -1;

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      /* The single place anything is written. Once closed we stop rather than
         throw: a disconnected client is the normal end of a stream, not an
         error, and this is called from a microtask where a throw would be
         unhandled. */
      const write = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          teardown();
          return false;
        }
      };

      function teardown() {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed by the runtime */ }
      }

      const send = (e: { seq: number }) => write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);

      // replay what this client missed before going live, so a reconnect never
      // leaves a hole between its cursor and the first live event
      for (const e of store.since(ORG, from)) {
        if (!send(e)) return;
      }

      unsubscribe = store.subscribe(ORG, send);
      // comment frames stop intermediaries closing an idle connection
      heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);

      // the client going away is the usual exit, not a failure
      if (req.signal.aborted) teardown();
      else req.signal.addEventListener("abort", teardown, { once: true });
    },

    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // a buffering proxy would defeat the point of streaming
      "x-accel-buffering": "no",
    },
  });
}
