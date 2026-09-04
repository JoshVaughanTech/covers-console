import type { Metadata } from "next";

/* The parent layout titles the app "Breaks", which is the wrong name for this
   route. Only the title changes: viewport, safe areas and the single-column
   shell are the parent's and are correct for both screens. */
export const metadata: Metadata = {
  title: "Covers — Open shifts",
  description: "Open shifts you can take.",
};

export default function ShiftsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
