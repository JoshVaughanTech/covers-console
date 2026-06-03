import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHead } from "./page-head";

/* ============================================================
   Placeholder — for console modules not part of the recreated
   Console kit (Jobs, People, Reports, Settings).
   ============================================================ */

export function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <PageHead title={title} sub="This module isn't part of the recreated Console kit." />
      <Card
        style={{
          padding: 56,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
        }}
      >
        <span
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "var(--fs-teal-tint)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="layers" size={26} color="var(--fs-teal)" />
        </span>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--fg-1)" }}>
          {title} screen not recreated
        </div>
        <div style={{ fontSize: 13.5, color: "var(--fg-3)", maxWidth: 380 }}>
          The Console kit recreates Overview, Schedule, Time &amp; Attendance, Credentials,
          Communications and Projects. Other modules are intentionally left blank.
        </div>
      </Card>
    </div>
  );
}
