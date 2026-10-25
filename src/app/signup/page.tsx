import { AuthForm } from "@/components/auth-form";
import { AuthExperience } from "@/components/auth-experience";
import { getSupabaseConfig } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accountDestination } from "@/features/auth/onboarding";
import { redirect } from "next/navigation";

export default async function Signup() {
  const client = await createSupabaseServerClient({ readOnlyCookies: true });
  if (client) {
    const { data } = await client.auth.getUser();
    if (data.user?.email_confirmed_at) redirect(await accountDestination(client, data.user.id));
  }
  return (
    <AuthExperience>
      <AuthForm action="signup" configured={Boolean(getSupabaseConfig())} />
    </AuthExperience>
  );
}
