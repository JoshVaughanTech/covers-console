"use client";

/* ============================================================
   The pieces the board and the shift detail both render.

   These lived inside the board screen while it was the only thing
   that drew a shift. The detail screen at /m/shifts/[id] draws the
   same pay panel, the same banners and the same money formatting,
   and a second copy of PayPanel is a second answer to "what does
   this shift pay" waiting to drift from the first.

   The server already refuses to send two answers — see
   lib/shifts/view.ts. This is the same rule one layer up.
   ============================================================ */

export type Standing = "open" | "declined" | "lapsed" | "assigned";

/**
 * What the shift pays, already checked against the award by the server.
 *
 * Every figure here arrives computed. The phone does no rate arithmetic of its
 * own on purpose: "above award" on this card has to be the same answer that
 * stopped the venue posting below it, and two implementations of the same sum
 * is how they come to disagree. Null means no rate is published yet — which
 * the card says, rather than showing a number nobody set.
 */
export interface Pay {
  offeredHourlyCents: number;
  floorHourlyCents: number;
  marginHourlyCents: number;
  estGrossCents: number;
  paidHours: number;
  unpaidHours: number;
  atOrAboveFloor: boolean;
  bands: { band: string; label: string; hours: number; hourlyCents: number }[];
  mixedRates: boolean;
  awardId: string;
  publicHolidaysChecked: boolean;
  summary: string;
  notModelled: string[];
}

export interface Shift {
  id: string;
  role: string;
  functionName: string;
  client: string | null;
  siteId: string;
  siteName: string;
  day: string;
  window: string;
  seats: number;
  seatsLeft: number;
  duties: string[];
  requires: { skill: string; level: string }[];
  /** null until the venue publishes a rate. */
  pay: Pay | null;
  status: string;
  blockReason: string | null;
  standing: { standing: Standing; at: string; reason: string | null } | null;
  /** already on the roster for this shift, claim or no claim. */
  rostered: boolean;
  claimable: boolean;
}

/** A claim this device has sent, and what became of it. */
export interface Sent {
  state: "sending" | "ok" | "failed";
  reason?: string;
}

/** 4150 → "$41.50". Formatting only; the arithmetic happened on the server. */
export const aud = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}$${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};

export const DUTY_LABEL: Record<string, string> = {
  serve_alcohol: "Serve alcohol",
  handle_food: "Handle food",
  gaming: "Gaming",
  supervise: "Supervise",
};

export const chip = (tone: string): React.CSSProperties => ({
  fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "3px 8px",
  color: `var(--${tone}-fg)`, background: `var(--${tone}-bg)`,
});

export function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block", marginTop: 7, fontSize: 11.5, fontWeight: 600,
        color: `var(--${tone}-fg)`, background: `var(--${tone}-bg)`,
        borderRadius: 999, padding: "4px 9px",
      }}
    >
      {children}
    </span>
  );
}

export function Banner({ tone, children }: { tone: "danger" | "warn" | "success" | "info"; children: React.ReactNode }) {
  const bg = `var(--${tone === "warn" ? "warning" : tone}-bg)`;
  const fg = `var(--${tone === "warn" ? "warning" : tone}-fg)`;
  return (
    <div
      style={{
        background: bg, color: fg, borderRadius: 10, padding: "10px 12px",
        fontSize: 13, lineHeight: 1.5, marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The award maths, shown rather than summarised.
 *
 * The point of this panel is that a casual can check it. "Above award" as a
 * badge is a marketing claim; the same badge next to the floor it beat, the
 * hours it was worked out over, and the clause it comes from is something a
 * person can argue with — which is the only version worth putting in front of
 * someone whose pay it describes.
 *
 * It also says what it does not cover. A gross figure that quietly excludes
 * overtime and allowances, presented as "your pay", is the kind of number that
 * is believed until payday.
 */
export function PayPanel({ pay }: { pay: Pay }) {
  return (
    <section
      style={{
        background: "var(--fs-navy, #0a1a28)", color: "#fff", borderRadius: 14,
        padding: "14px 15px", margin: "0 0 14px",
      }}
    >
      {/* globals.css colours h3 and p with --fg-1 / --fg-2, which are dark by
          design and invisible on this panel. Inheritance does not reach them,
          so every element here states its own colour. */}
      <h3
        style={{
          margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em",
          textTransform: "uppercase", color: "#fff", opacity: 0.65,
        }}
      >
        Your pay for this shift
      </h3>

      <p style={{ margin: "6px 0 0", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", color: "#fff" }}>
        <span className="fs-tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>
          {aud(pay.estGrossCents)}
        </span>
        <span style={{ fontSize: 12.5, opacity: 0.7 }}>
          est. gross · {pay.paidHours}h at {aud(pay.offeredHourlyCents)}/h
        </span>
      </p>

      {/* Per band, because this is the part a single rate hides: an eight-hour
          Friday that runs past midnight is not eight Friday hours. */}
      <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", fontSize: 12.5, color: "#fff" }}>
        {pay.bands.map((b) => (
          <li key={b.band} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
            <span style={{ opacity: 0.75 }}>
              {b.label} · {b.hours}h
            </span>
            <span className="fs-tnum" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
              award {aud(b.hourlyCents)}/h
            </span>
          </li>
        ))}
        {/* The rows above cover the shift end to end, so they have to be
            reconciled with the paid hours rather than quietly not adding up. */}
        {pay.unpaidHours > 0 && (
          <li style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", opacity: 0.75 }}>
            <span>Unpaid meal break</span>
            <span className="fs-tnum" style={{ whiteSpace: "nowrap" }}>−{pay.unpaidHours}h</span>
          </li>
        )}
      </ul>

      <p
        style={{
          margin: "12px 0 0", padding: "9px 10px", borderRadius: 9, fontSize: 12.5, lineHeight: 1.5,
          background: pay.atOrAboveFloor ? "rgba(18,217,198,.14)" : "rgba(255,120,120,.16)",
          color: pay.atOrAboveFloor ? "var(--fs-teal-bright, #12d9c6)" : "#ffb4b4",
          fontWeight: 600,
        }}
      >
        {pay.atOrAboveFloor
          ? `✓ ${aud(pay.offeredHourlyCents)}/h clears the ${pay.awardId} floor for every hour of this shift — the dearest hour is ${aud(pay.floorHourlyCents)}/h.`
          : `This rate is below the ${pay.awardId} floor of ${aud(pay.floorHourlyCents)}/h.`}
      </p>

      <p style={{ margin: "10px 0 0", fontSize: 11, lineHeight: 1.5, color: "#fff", opacity: 0.6 }}>
        {pay.awardId} cl 18 &amp; 29. Estimate for ordinary hours — excludes {pay.notModelled.slice(0, 3).join(", ")} and
        super.
        {!pay.publicHolidaysChecked && " Public holidays are not checked for this site."}
      </p>
    </section>
  );
}
