"use client";

import { useEffect, useState } from "react";
import { WORKERS } from "@/lib/idara/seed";

/* ============================================================
   Signing in.

   Two steps, and the split is the point. Picking your name is
   addressing, not authentication — it always was, and the old screen
   was wrong only in stopping there. The code is what checks.

   Shared by both phone screens. Whichever one you land on, the
   session it produces is the same session, because it is the server
   that holds it and not the tab.

   The screen is honest about the channel. With no mail transport the
   code comes back in the response, which proves nothing about who
   received it, and saying so where the operator can see it is better
   than a reassuring screen over a hole.
   ============================================================ */

export interface Signed {
  did: string;
  name: string;
  role: string;
}

/* Why a link sent someone back here. The redirect carries a reason and it
   would be silent without this — somebody who tapped a stale link would land
   on a sign-in screen with no idea why it did not work. */
const LINK_REASON: Record<string, string> = {
  spent: "That link has already been used. Ask for a new one.",
  expired: "That link has expired. Ask for a new one.",
  unknown: "That link is not valid any more. Ask for a new one.",
  too_many_attempts: "Too many tries on that link. Ask for a new one.",
  missing: "That link was incomplete. Ask for a new one.",
};

interface Requested {
  expiresAt?: number;
  via: string;
  outOfBand: boolean;
  code?: string;
}

export function SignIn({ onSignedIn }: { onSignedIn: (s: Signed) => void }) {
  const [who, setWho] = useState<{ did: string; name: string } | null>(null);
  const [asked, setAsked] = useState<Requested | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkReason, setLinkReason] = useState<string | null>(null);

  /* Clear the identity the old scheme kept on the device.

     Nothing reads it any more, so it is inert — but it is a name that used to
     be authoritative, sitting where a future reader could find it and think
     it still is. Removing it is what makes the migration finished rather than
     merely stopped. */
  useEffect(() => {
    try {
      window.localStorage.removeItem("covers.supervisor");
    } catch {
      /* private mode: nothing was stored there either */
    }
    // read from location rather than useSearchParams: this component renders
    // inside a statically prerendered route, where the hook needs a Suspense
    // boundary it does not otherwise want
    const reason = new URLSearchParams(window.location.search).get("signin");
    if (reason) {
      setLinkReason(LINK_REASON[reason] ?? LINK_REASON.unknown);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function ask(did: string, name: string) {
    setWho({ did, name });
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ did }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not request a code");
      setAsked(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request a code");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!who || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ did: who.did, code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "That code is not right.");
      onSignedIn(body.worker as Signed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code is not right.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (!who) {
    return (
      <div style={{ padding: "28px 18px" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 23, letterSpacing: "-.02em" }}>Who are you?</h1>
        {linkReason && (
          <p
            style={{
              background: "var(--warning-bg)", color: "var(--warning-fg)", borderRadius: 10,
              padding: "10px 12px", margin: "10px 0 0", fontSize: 13, lineHeight: 1.5,
            }}
          >
            {linkReason}
          </p>
        )}
        <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.55 }}>
          Pick your name, then enter the code your manager gives you. Shifts are offered against
          your credentials, and everything you do is recorded against your name.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {WORKERS.map((w) => (
            <button
              key={w.did}
              onClick={() => ask(w.did, w.name)}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                minHeight: 56, padding: "10px 14px", borderRadius: 12,
                border: "1px solid var(--border)", background: "#fff", cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 36, height: 36, borderRadius: 999, background: "var(--bg-2)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12.5, fontWeight: 700, color: "var(--fg-3)", flexShrink: 0,
                }}
              >
                {w.name.split(" ").map((x) => x[0]).join("")}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--fg-1)" }}>{w.name}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)" }}>{w.role}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 18px" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 23, letterSpacing: "-.02em" }}>
        Hello, {who.name.split(" ")[0]}
      </h1>
      <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.55 }}>
        {asked?.outOfBand
          ? "Ask your manager for your sign-in code, then type it below. It lasts fifteen minutes."
          : "Enter your sign-in code. It lasts fifteen minutes."}
      </p>

      {/* The code came back in the response because nothing else could carry
          it. That is a real gap and the screen says so rather than presenting
          it as though a channel had verified anything. */}
      {asked?.code && (
        <div
          style={{
            background: "var(--warning-bg)", color: "var(--warning-fg)", borderRadius: 10,
            padding: "12px 14px", marginBottom: 16, fontSize: 13, lineHeight: 1.55,
          }}
        >
          <strong>No delivery channel is configured</strong>, so the code is shown here rather
          than sent to you. Anyone who can reach this page could read it.
          <span
            style={{
              display: "block", marginTop: 8, fontSize: 26, fontWeight: 700,
              letterSpacing: ".08em", fontVariantNumeric: "tabular-nums",
            }}
          >
            {asked.code}
          </span>
        </div>
      )}

      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
        placeholder="ABCD-2345"
        autoComplete="one-time-code"
        // a code is characters, not prose: the phone should not helpfully
        // capitalise, correct or autocomplete it into something else
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        style={{
          width: "100%", minHeight: 54, padding: "0 14px", borderRadius: 12,
          border: "1px solid var(--border-2)", background: "#fff",
          fontSize: 20, fontWeight: 600, letterSpacing: ".1em", textAlign: "center",
          textTransform: "uppercase", color: "var(--fg-1)",
        }}
      />

      {error && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--danger-fg)" }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          onClick={() => { setWho(null); setAsked(null); setCode(""); setError(null); }}
          style={{
            flex: 1, minHeight: 50, borderRadius: 12, fontSize: 15, fontWeight: 600,
            border: "1px solid var(--border-2)", background: "#fff", color: "var(--fg-2)", cursor: "pointer",
          }}
        >
          Not me
        </button>
        <button
          onClick={submit}
          disabled={busy || !code.trim()}
          style={{
            flex: 2, minHeight: 50, borderRadius: 12, fontSize: 15, fontWeight: 700,
            border: "1px solid var(--accent, var(--fg-1))",
            background: "var(--accent, var(--fg-1))", color: "#fff",
            cursor: busy || !code.trim() ? "default" : "pointer",
            opacity: busy || !code.trim() ? 0.6 : 1,
          }}
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </div>

      <button
        onClick={() => ask(who.did, who.name)}
        disabled={busy}
        style={{
          marginTop: 12, width: "100%", background: "none", border: "none",
          fontSize: 13, color: "var(--fg-4)", textDecoration: "underline", cursor: "pointer",
        }}
      >
        Send me a new code
      </button>
    </div>
  );
}
