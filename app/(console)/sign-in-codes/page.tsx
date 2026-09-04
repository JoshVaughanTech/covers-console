"use client";

import { useEffect, useState } from "react";
import { Card, Avatar, Badge, Button, Icon, useToast } from "@/components/ui";
import { CardHead, PageHead } from "@/components/screen/page-head";
import { WORKERS } from "@/lib/idara/seed";

/* ============================================================
   Phone sign-in — minting a code for somebody standing in front of
   you.

   Its own screen rather than a section of Credentials, because that
   page is a mock with its own invented staff and no DIDs. Two lists
   of different fictional people on one page would be worse than a
   short screen that means one thing.

   Two honesty rules shape it, and neither is decoration.

   It names the identity it is about to write into the chain. That
   line used to read "recorded as Emma Taylor, because this console
   has no sign-in of its own" — uncomfortable on purpose, because it
   was true. Console sign-in arrived, and the same sentence is now
   ordinary: the name is the one that proved itself at the door. That
   was the argument for saying it plainly rather than vaguely — a
   vague line would still be sitting here, technically true and no
   longer meaning anything.

   And it does not show the code unless the server was configured in
   a way that already exposes it. An operator surface answering with
   a live credential would be the oracle closed twice this morning,
   wearing a nicer interface.
   ============================================================ */

interface Issued {
  worker: { did: string; name: string; role: string };
  expiresAt: number;
  via: string;
  outOfBand: boolean;
  code?: string;
  recordedAs: { name: string; did: string };
}

interface Failed {
  error: string;
  detail?: string;
  reason?: string;
}

const fmtExpiry = (epoch: number) =>
  new Date(epoch * 1000).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

export default function SignInCodesPage() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [query, setQuery] = useState("");
  const [me, setMe] = useState<{ name: string; role: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/auth/session");
        const b = await r.json();
        if (b.signedIn && b.kind === "operator") setMe(b.operator);
      } catch {
        /* the shell handles a missing session; do not assert a name here */
      }
    })();
  }, []);

  const shown = WORKERS.filter((w) =>
    `${w.name} ${w.role}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function issue(did: string, name: string) {
    setBusy(did);
    setIssued(null);
    setFailed(null);
    try {
      const res = await fetch("/api/auth/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ did }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFailed(body as Failed);
        return;
      }
      setIssued(body as Issued);
      toast(`Sign-in code issued for ${name}`, { tone: "success", icon: "key-round" });
    } catch (e) {
      setFailed({ error: e instanceof Error ? e.message : "Could not reach the server" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead
        title="Phone sign-in"
        sub="Issue a one-time code so someone can sign in on their own phone. Codes last fifteen minutes and work once."
      />

      {/* This said "recorded as Emma Taylor, because this console has no
          sign-in of its own yet" for as long as that was true. It is not any
          more, and a screen that kept saying it would be understating the
          system rather than overstating it — the rarer mistake, and still a
          lie. The name is now the one that proved itself at the door. */}
      <Card pad={14} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Icon name="shield-check" size={18} style={{ color: "var(--fs-teal)", marginTop: 1 }} />
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--fg-2)" }}>
            Codes issued here are recorded in the audit log against{" "}
            <strong>{me?.name ?? "you"}</strong>, the operator signed in on this console. The code
            itself is written to the server and never shown to whoever asked for it.
          </div>
        </div>
      </Card>

      {issued && <IssuedPanel issued={issued} onDismiss={() => setIssued(null)} />}

      {failed && (
        <Card pad={14} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <Icon name="circle-alert" size={18} style={{ color: "var(--danger-fg)", marginTop: 1 }} />
            <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              <strong>{failed.error}</strong>
              {failed.detail && (
                <span style={{ display: "block", marginTop: 4, color: "var(--fg-3)" }}>
                  {failed.detail}
                </span>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card pad={0}>
        <div style={{ padding: "16px 16px 0" }}>
          <CardHead title={`Staff (${shown.length})`} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find someone"
            style={{
              width: "100%",
              maxWidth: 320,
              marginBottom: 14,
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13.5,
              border: "1px solid var(--border-2)",
              background: "var(--bg)",
              color: "var(--fg-1)",
            }}
          />
        </div>

        <div style={{ borderTop: "1px solid var(--border)" }}>
          {shown.map((w) => (
            <div
              key={w.did}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <Avatar name={w.name} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{w.name}</div>
                <div style={{ fontSize: 12, color: "var(--fg-4)" }}>{w.role}</div>
              </div>
              <Button variant="sec" onClick={() => issue(w.did, w.name)} disabled={busy !== null}>
                {busy === w.did ? "Issuing…" : "Issue code"}
              </Button>
            </div>
          ))}
          {shown.length === 0 && (
            <div style={{ padding: "20px 16px", fontSize: 13.5, color: "var(--fg-4)" }}>
              Nobody by that name.
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function IssuedPanel({ issued, onDismiss }: { issued: Issued; onDismiss: () => void }) {
  const firstName = issued.worker.name.split(" ")[0];

  return (
    <Card pad={16} style={{ marginBottom: 16, borderColor: "var(--success)" }}>
      <CardHead
        title={`Code issued for ${issued.worker.name}`}
        right={
          <Button variant="ghost" onClick={onDismiss}>
            Done
          </Button>
        }
      />

      {issued.code ? (
        <>
          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: ".12em",
              fontVariantNumeric: "tabular-nums",
              color: "var(--fg-1)",
            }}
          >
            {issued.code}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--fg-3)" }}>
            Read this to {firstName}. It expires at <strong>{fmtExpiry(issued.expiresAt)}</strong>{" "}
            and works once.
          </p>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--fg-3)", lineHeight: 1.6 }}>
          The code went to <strong>{issued.via}</strong> rather than to this screen, because this
          server has a delivery channel configured. It expires at{" "}
          <strong>{fmtExpiry(issued.expiresAt)}</strong> and works once.
        </p>
      )}

      {/* The support call this screen is the only place to prevent. */}
      <div
        style={{
          marginTop: 12,
          padding: "10px 12px",
          borderRadius: 8,
          background: "var(--warning-bg)",
          color: "var(--warning-fg)",
          fontSize: 12.5,
          lineHeight: 1.55,
        }}
      >
        This replaces any code {firstName} already had. If they were given an earlier one it will
        now be refused, so make sure they use this one.
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge tone="neutral">Recorded as {issued.recordedAs.name}</Badge>
        <span style={{ fontSize: 12, color: "var(--fg-4)" }}>
          in the audit log, against {issued.worker.name}
        </span>
      </div>
    </Card>
  );
}
