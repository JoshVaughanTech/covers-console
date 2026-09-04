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
   Who may read it, and how much.

   The chain is the venue's compliance record — every break decision,
   every claim, every credential revocation, for everybody. An
   operator gets it. A worker does not, and until console sign-in
   existed this route asked neither, which made the audit log the
   first thing a worker reached after signing in on their phone.

   A worker still gets a tick, because that is all the phone ever
   used this for: es.onmessage refetches /api/breaks and never reads
   the payload. So one mechanism serves both, and the caller that
   needs less is given less rather than given everything and trusted
   to look away.
   ============================================================ */
import { eventStore } from "@/lib/store/events";
import { operatorOf, workerOf } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const ORG = process.env.COVERS_ORG ?? "org-brightwater";
const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  const operator = operatorOf(req);
  // a worker learns that something happened, never what
  const worker = operator ? null : workerOf(req);
  if (!operator && !worker) {
    return new Response("not signed in", { status: 401 });
  }
  const full = operator !== null;

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

      /* An operator receives the event. A worker receives its sequence number
         and nothing else — enough to know they are behind and refetch what
         they are allowed to see, and not enough to learn anything about
         anybody. */
      const send = (e: { seq: number }) =>
        write(`id: ${e.seq}\ndata: ${JSON.stringify(full ? e : { seq: e.seq })}\n\n`);

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
