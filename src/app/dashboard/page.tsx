import { redirect } from "next/navigation";

// Keep existing authentication/onboarding destinations working through the guarded profile.
export default function Dashboard() {
  redirect("/profile");
}
