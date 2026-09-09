import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/* Self-hosted rather than fetched from Google at build time.

   next/font/google downloads the files during `next build`, which makes the
   build depend on a third-party CDN being reachable. That failed here once and
   passed on retry with nothing changed — a check reporting on the network
   rather than on the code, and the reason CI could not be made a merge gate:
   a gate that blocks on the weather is one somebody eventually switches off.

   Both are the variable builds, so one file per family covers every weight
   instead of five and two static cuts. See app/fonts/README.md for provenance
   and how to update them; the licences are beside them, as the OFL requires. */

/* Plus Jakarta Sans — display + UI + body (nearest match to the
   geometric-humanist sans in the Covers artwork). */
const jakarta = localFont({
  src: "./fonts/PlusJakartaSans-Variable-latin.woff2",
  // the axis the file actually carries; Next serves 400–800 from this one file
  weight: "200 800",
  style: "normal",
  variable: "--font-jakarta",
  display: "swap",
});

/* JetBrains Mono — IDs, timers, codes. */
const jbMono = localFont({
  src: "./fonts/JetBrainsMono-Variable-latin.woff2",
  weight: "100 800",
  style: "normal",
  variable: "--font-jb-mono",
  display: "swap",
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
