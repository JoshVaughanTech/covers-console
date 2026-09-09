import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/* ============================================================
   Fonts are in the repository, not fetched at build time.

   `next/font/google` downloads the files during `next build`, which
   makes every build depend on fonts.gstatic.com being reachable. On
   a laptop that is an occasional annoyance. In CI it is the reason
   required status checks could not be turned on: a merge blocked by
   somebody else's CDN is the false-positive that gets a gate
   switched off rather than fixed, and the gate is the thing this
   repository spent a week acquiring.

   So the two files sit in app/fonts. `next/font/local` gives the
   same self-hosting, the same generated CSS variables, and the same
   zero-layout-shift metric fallbacks — it simply reads from disk.

   VARIABLE FONTS, ONE FILE EACH. Both families ship a variable
   weight axis, so a single woff2 covers every weight the design
   uses rather than five and two static cuts. 27KB and 40KB against
   roughly 90KB of static files, and any weight in the axis is now
   available rather than only the ones enumerated here.

   Latin subset only, matching the `subsets: ["latin"]` these
   replaced. Nothing in the console renders Cyrillic or Vietnamese,
   and shipping those subsets would triple the bytes for glyphs no
   screen asks for.

   LICENSING IS NOT INCIDENTAL. Both families are SIL Open Font
   License 1.1, which permits bundling and redistribution and
   requires the licence travel with the files. Both OFL texts are in
   app/fonts beside the fonts they cover, with their upstream
   copyright lines intact. Do not remove them; the right to ship
   these files depends on them being there.
   ============================================================ */

/* Plus Jakarta Sans — display + UI + body (nearest match to the
   geometric-humanist sans in the Covers artwork). */
const jakarta = localFont({
  src: "./fonts/PlusJakartaSans-Variable-latin.woff2",
  /* The axis, not a list. `weight` on a variable font declares the
     range it can render, so 600 and 800 resolve from the same file. */
  weight: "200 800",
  variable: "--font-jakarta",
  display: "swap",
  /* What the browser measures the fallback against while the font
     loads. next/font/google inferred this; a local font has to be
     told, and without it the swap shifts the layout — the exact
     thing `display: "swap"` is otherwise paired with adjustments to
     avoid. */
  adjustFontFallback: "Arial",
});

/* JetBrains Mono — IDs, timers, codes. */
const jbMono = localFont({
  src: "./fonts/JetBrainsMono-Variable-latin.woff2",
  weight: "100 800",
  variable: "--font-jb-mono",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: "Covers — Every cover, covered",
  description:
    "Fairer scheduling. Real-time visibility. Verified people. All in one connected platform. Powered by idara.",
  icons: { icon: "/assets/covers-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jbMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
