import type { Metadata } from "next";

/* The parent titles this route "Open shifts", which is the board's name and
   not this screen's. Only the title changes. */
export const metadata: Metadata = {
  title: "Covers — Shift",
  description: "A shift you can take, and what it pays.",
};

export default function ShiftDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
