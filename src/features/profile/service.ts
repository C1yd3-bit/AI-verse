import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getStreamConfig } from "@/features/media/stream";
import { privateProfileSchema, type ProfileInput, type ProfileSnapshot } from "./schema";

export async function readPrivateProfile(client: SupabaseClient, user: User) {
  const result = await client.rpc("get_my_profile");
  if (result.error) return { error: result.error, data: null };
  const parsed = privateProfileSchema.safeParse(result.data);
  if (!parsed.success) return { error: { code: "invalid_projection" }, data: null };
  const snapshot: ProfileSnapshot = {
    ...parsed.data,
    accountId: user.id,
    account: parsed.data.account ? { ...parsed.data.account, email: user.email ?? null } : null,
    uploadsAvailable:
      Boolean(getStreamConfig()) && process.env.AIVERSE_ENABLE_STREAM_UPLOADS === "true",
  };
  return { data: snapshot, error: null };
}

export async function updatePrivateProfile(client: SupabaseClient, input: ProfileInput) {
  if (input.action === "appearance")
    return client.rpc("set_my_appearance", { requested_theme: input.theme });
  const { action: _action, ...payload } = input;
  void _action;
  return client.rpc("update_my_account_information", { payload });
}
