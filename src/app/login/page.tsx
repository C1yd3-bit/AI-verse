import { AuthForm } from "@/components/auth-form";
import { AuthExperience } from "@/components/auth-experience";
import { getSupabaseConfig } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accountDestination } from "@/features/auth/onboarding";
import { redirect } from "next/navigation";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const client = await createSupabaseServerClient({ readOnlyCookies: true });
  if (client) {
    const { data } = await client.auth.getUser();
    if (data.user?.email_confirmed_at) redirect(await accountDestination(client, data.user.id));
  }
  const query = await searchParams;
  return (
    <AuthExperience>
      <AuthForm
        action="login"
        configured={Boolean(getSupabaseConfig())}
        initialError={
          query.error
            ? "That sign-in or confirmation could not finish. Try logging in with email, or request a new code when creating your account."
            : ""
        }
      />
    </AuthExperience>
  );
}
