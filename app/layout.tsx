import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/* Plus Jakarta Sans — display + UI + body (nearest match to the
   geometric-humanist sans in the Covers artwork). */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

/* JetBrains Mono — IDs, timers, codes. */
const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
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
