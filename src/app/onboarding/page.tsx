import { AuthExperience } from "@/components/auth-experience";
import { OnboardingForm } from "@/components/onboarding-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accountDestination } from "@/features/auth/onboarding";
import { redirect } from "next/navigation";

export default async function Onboarding({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const client = await createSupabaseServerClient({ readOnlyCookies: true });
  if (!client) redirect("/login");
  const { data } = await client.auth.getUser();
  if (!data.user?.email_confirmed_at) redirect("/login");
  const query = await searchParams;
  const completed = (await accountDestination(client, data.user.id)) === "/dashboard";
  if (completed && query.edit !== "1") redirect("/dashboard");
  return (
    <AuthExperience>
      <OnboardingForm editing={completed} />
    </AuthExperience>
  );
}
