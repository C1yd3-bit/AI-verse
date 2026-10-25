import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { preferenceSchema } from "@/features/preferences/schema";

/** Plausibility bounds only; this does not establish an age eligibility policy. */
export const accountInformationSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => value.length <= 80, "Use at most 80 UTF-16 units"),
    age: z.number().int().min(1).max(120),
    contactNumber: z
      .string()
      .trim()
      .min(7)
      .max(32)
      .regex(/^\+?[0-9() .-]+$/)
      .refine((value) => {
        const count = value.replace(/\D/g, "").length;
        return count >= 7 && count <= 15;
      })
      .nullable(),
  })
  .strict();
export const onboardingInputSchema = accountInformationSchema
  .extend({
    preferences: preferenceSchema,
    ethnicity: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => value.length <= 100, "Use at most 100 UTF-16 units")
      .nullable(),
    ethnicityConsent: z.boolean(),
  })
  .strict()
  .refine(
    (input) =>
      input.ethnicity === null ? input.ethnicityConsent === false : input.ethnicityConsent === true,
    {
      message: "Sharing personal ethnicity is optional and requires explicit consent",
      path: ["ethnicityConsent"],
    },
  );
export type AccountOnboardingInput = z.infer<typeof onboardingInputSchema>;

/** Owner-scoped completion lookup. A missing migration/error never skips onboarding. */
export async function accountDestination(
  client: SupabaseClient,
  userId: string,
): Promise<"/onboarding" | "/dashboard"> {
  const { data, error } = await client
    .from("account_details")
    .select("completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  return !error && data?.completed_at ? "/dashboard" : "/onboarding";
}
