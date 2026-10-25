import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfilePanel } from "@/components/profile-panel";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import "../studio/studio.css";
import "./profile.css";

export const metadata: Metadata = {
  title: "Your profile",
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  const client = await createSupabaseServerClient({ readOnlyCookies: true });
  if (!client) redirect("/login");
  const { data } = await client.auth.getUser();
  if (!data.user?.email_confirmed_at) redirect("/login");
  const account = await client
    .from("account_details")
    .select("completed_at")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!account.error && !account.data?.completed_at) redirect("/onboarding");
  // A database failure stays recoverable through the panel's authenticated retry.
  return <ProfilePanel key={data.user.id} accountId={data.user.id} />;
}
