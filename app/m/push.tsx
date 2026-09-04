"use client";

import { useEffect, useState } from "react";

/* ============================================================
   Turning shift alerts on, from the phone.

   Asks for permission when the worker taps, never on load. A
   permission prompt on arrival is the one users deny reflexively,
   and a denial is close to permanent — the browser stops asking, and
   the only way back is through settings most people will not find.
   So the button explains what it is for first, and the prompt only
   appears after somebody has decided they want it.

   The whole control hides itself when it cannot work. Push needs a
   service worker, which needs HTTPS or localhost — so on the plain
   http LAN address a venue uses to reach this from a phone, none of
   this exists. Showing a dead button there would be worse than
   showing nothing: it would look like the feature is broken rather
   than unavailable, and somebody would spend an afternoon on it.
   ============================================================ */

type State = "checking" | "unsupported" | "unconfigured" | "off" | "on" | "denied" | "working";

/**
 * base64url VAPID key to the bytes the subscribe call wants.
 *
 * Returns an ArrayBuffer rather than a Uint8Array: applicationServerKey is
 * typed as BufferSource backed by a real ArrayBuffer, and a Uint8Array over
 * an ArrayBufferLike does not satisfy it. The runtime accepts either, which
 * is why this is only ever caught by the type checker.
 */
function toKeyBytes(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export function PushToggle() {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      /* isSecureContext rather than checking the protocol: it is the exact
         condition the browser applies, and it is true on localhost, which is
         where this gets developed. */
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      try {
        const res = await fetch("/api/push/subscribe");
        const body = await res.json();
        if (!body.available) {
          setState("unconfigured");
          return;
        }
        const reg = await navigator.serviceWorker.getRegistration();
        const existing = await reg?.pushManager.getSubscription();
        setState(existing ? "on" : "off");
      } catch {
        setState("unsupported");
      }
    })();
  }, []);

  async function turnOn() {
    setState("working");
    setError(null);
    try {
      const { publicKey } = await fetch("/api/push/subscribe").then((r) => r.json());
      if (!publicKey) throw new Error("Push is not configured on this server");

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        // required on every current browser; a subscription without it is
        // one any server could push to
        userVisibleOnly: true,
        applicationServerKey: toKeyBytes(publicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save the subscription");

      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn alerts on");
      setState("off");
    }
  }

  async function turnOff() {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        /* Told the server first. Unsubscribing locally and failing to say so
           leaves a row that is pushed to forever and counted as a person who
           was notified. */
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  }

  // nothing to say, and saying it would look like a fault
  if (state === "checking" || state === "unsupported" || state === "unconfigured") return null;

  const box: React.CSSProperties = {
    width: "100%", marginBottom: 14, padding: "11px 13px", borderRadius: 12,
    border: "1px solid var(--border-2)", background: "#fff",
    fontSize: 13.5, textAlign: "left", lineHeight: 1.5,
  };

  if (state === "denied") {
    return (
      <div style={{ ...box, color: "var(--fg-4)" }}>
        <strong style={{ color: "var(--fg-2)" }}>Alerts are blocked</strong>
        <span style={{ display: "block", marginTop: 2 }}>
          Your browser is set to block notifications from this site. It will not ask again — you
          can turn them back on in its settings.
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={state === "on" ? turnOff : turnOn}
        disabled={state === "working"}
        style={{ ...box, cursor: state === "working" ? "default" : "pointer", fontWeight: 600 }}
      >
        {state === "on" ? "Shift alerts are on" : "Get alerts when a shift you can take is posted"}
        <span style={{ display: "block", fontWeight: 400, fontSize: 12.5, marginTop: 2, color: "var(--fg-4)" }}>
          {state === "working"
            ? "One moment…"
            : state === "on"
              ? "Tap to stop them on this device"
              : "Only shifts you are eligible for. Tap to turn on."}
        </span>
      </button>
      {error && (
        <p style={{ margin: "-6px 0 14px", fontSize: 12.5, color: "var(--danger-fg)" }}>{error}</p>
      )}
    </>
  );
}
