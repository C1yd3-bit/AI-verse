import { z } from "zod";
import { accountInformationSchema } from "@/features/auth/onboarding";

export const appearanceThemeSchema = z.enum(["dark", "light"]);
export const profileInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("appearance"), theme: appearanceThemeSchema }).strict(),
  accountInformationSchema.extend({ action: z.literal("account") }).strict(),
]);

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const engagement = { likes: count, creditedCompletions: count };
/** An explicit private projection: reject unexpected fields rather than serialize them. */
export const privateProfileSchema = z
  .object({
    account: z
      .object({
        fullName: z.string(),
        age: z.number().int(),
        contactNumber: z.string().nullable(),
        completedAt: z.string(),
      })
      .strict()
      .nullable(),
    appearance: z.object({ theme: appearanceThemeSchema }).strict(),
    creator: z
      .object({
        approved: z.boolean(),
        suspended: z.boolean(),
        applicationStatus: z.enum(["pending", "approved", "rejected"]).nullable(),
      })
      .strict(),
    stats: z
      .object({
        total: count,
        published: count,
        pendingReview: count,
        drafts: count,
        ...engagement,
      })
      .strict(),
    content: z
      .array(
        z
          .object({
            id: z.uuid(),
            title: z.string(),
            format: z.enum(["reel", "movie"]).nullable(),
            state: z.enum([
              "draft",
              "uploading",
              "processing",
              "pending_review",
              "published",
              "rejected",
              "failed",
              "hidden",
              "removed",
            ]),
            createdAt: z.string(),
            ...engagement,
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type PrivateProfile = z.infer<typeof privateProfileSchema>;
export type ProfileSnapshot = Omit<PrivateProfile, "account"> & {
  accountId: string;
  account: (NonNullable<PrivateProfile["account"]> & { email: string | null }) | null;
  uploadsAvailable: boolean;
};
