import { redirect } from "next/navigation";

/* The console opens on the Overview dashboard. */
export default function Home() {
  redirect("/overview");
}
