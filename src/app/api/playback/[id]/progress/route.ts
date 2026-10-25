import { z } from "zod";
import { apiResponse, databaseFailure, requireAccount } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { playbackProgressInput } from "@/features/playback/schema";
import { recordPlaybackProgress } from "@/features/playback/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before continuing." }, 403);
  if (request.headers.get("x-aiverse-account") !== auth.user.id)
    return apiResponse(
      { error: "Your signed-in account changed. Refresh before continuing." },
      409,
    );
  const { id } = await context.params;
  const input = playbackProgressInput.safeParse(
    await readBoundedJson(request, 1024).catch(() => null),
  );
  if (!z.uuid().safeParse(id).success || !input.success)
    return apiResponse({ error: "Invalid playback activity." }, 400);
  const result = await recordPlaybackProgress(auth.client, id, input.data);
  return result.error ? databaseFailure(result.error) : apiResponse(result.data);
}
