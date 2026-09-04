"use client";

import { useEffect, useState } from "react";
import { OPERATORS } from "@/lib/auth/operators";

/* ============================================================
   The console door, from the outside.

   Outside the (console) route group on purpose: it must render for
   somebody who is not signed in, and everything in that group
   assumes a session and a shell.

   The code never appears here. Not in development, not with any
   environment variable — an operator credential mints everybody
   else's, so it only ever travels to a file on the server, and the
   only person who can complete this form is somebody who can read
   that file. That is the whole trust anchor, and it is worth saying
   on the screen rather than leaving the reader to wonder why nothing
   was emailed to them.
   ============================================================ */

export default function ConsoleSignInPage() {
  const [who, setWho] = useState<{ did: string; name: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [next, setNext] = useState("/overview");

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    // only a path from this app, never an absolute URL somebody supplied
    if (n && n.startsWith("/") && !n.startsWith("//")) setNext(n);
  }, []);

  async function ask(did: string, name: string) {
    setWho({ did, name });
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch("/api/auth/console/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ did }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not request a code");
        setDetail(body.detail ?? null);
        return;
      }
      setAsked(true);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!who || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/console/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ did: who.did, code }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "That code is not right.");
        setCode("");
        return;
      }
      window.location.href = next;
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 26, letterSpacing: "-.02em" }}>
          Sign in to Covers
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.6 }}>
          {who
            ? "Your code was written to the server's sign-in log. Someone with access to that file can read it to you."
            : "Pick your name. A one-time code will be written to a file on the server — it is never shown here and never emailed."}
        </p>

        {!who && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {OPERATORS.map((o) => (
              <button
                key={o.did}
                onClick={() => ask(o.did, o.name)}
                disabled={busy}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  textAlign: "left",
                  minHeight: 56,
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  cursor: busy ? "default" : "pointer",
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    background: "var(--bg-2)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "var(--fg-3)",
                    flexShrink: 0,
                  }}
                >
                  {o.name.split(" ").map((x) => x[0]).join("")}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>{o.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--fg-4)" }}>{o.role}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {who && asked && (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="ABCD-2345"
              autoComplete="one-time-code"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              style={{
                width: "100%",
                minHeight: 54,
                padding: "0 14px",
                borderRadius: 12,
                border: "1px solid var(--border-2)",
                background: "var(--surface)",
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: ".1em",
                textAlign: "center",
                textTransform: "uppercase",
                color: "var(--fg-1)",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                onClick={() => { setWho(null); setAsked(false); setCode(""); setError(null); }}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 12,
                  fontSize: 14.5,
                  fontWeight: 600,
                  border: "1px solid var(--border-2)",
                  background: "var(--surface)",
                  color: "var(--fg-2)",
                  cursor: "pointer",
                }}
              >
                Not me
              </button>
              <button
                onClick={submit}
                disabled={busy || !code.trim()}
                style={{
                  flex: 2,
                  minHeight: 48,
                  borderRadius: 12,
                  fontSize: 14.5,
                  fontWeight: 700,
                  border: "1px solid var(--fs-teal)",
                  background: "var(--fs-teal)",
                  color: "#fff",
                  cursor: busy || !code.trim() ? "default" : "pointer",
                  opacity: busy || !code.trim() ? 0.6 : 1,
                }}
              >
                {busy ? "Checking…" : "Sign in"}
              </button>
            </div>
          </>
        )}

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 14px",
              borderRadius: 10,
              background: "var(--danger-bg)",
              color: "var(--danger-fg)",
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            <strong>{error}</strong>
            {detail && <span style={{ display: "block", marginTop: 4 }}>{detail}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
