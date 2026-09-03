import type { Metadata, Viewport } from "next";

/* ============================================================
   The supervisor phone app.

   Deliberately not the console at a narrow width. A duty manager
   uses this on a floor, one-handed, mid-service, often with wet
   hands — so it gets its own layout: no sidebar, no topbar, one
   column, and tap targets sized for a thumb rather than a cursor.
   ============================================================ */

export const metadata: Metadata = {
  title: "Covers — Breaks",
  description: "Break compliance on the floor.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Covers" },
};

/* Next 15 wants this as its own export. Inside `metadata` it is ignored, so
   the tag never reaches the document and the phone lays the page out at
   desktop width and zooms out — a silent functional failure, not a lint nit. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--bg)",
        color: "var(--fg-1)",
        // safe areas keep the action bar clear of the home indicator
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {children}
    </div>
  );
}
