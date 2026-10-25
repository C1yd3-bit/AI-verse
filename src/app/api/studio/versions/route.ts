import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { versionInput } from "@/features/media/schema";

export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  // Comparison only: verified cookie identity and SQL authorization remain authoritative.
  const expectedAccount = request.headers.get("x-aiverse-account");
  if (expectedAccount !== null && expectedAccount !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the studio." }, 409);
  const input = versionInput.safeParse(await readBoundedJson(request, 20000).catch(() => null));
  if (!input.success)
    return apiResponse(
      { error: "Check the film details, AI disclosure and rights declaration." },
      400,
    );
  const result = await auth.client.rpc("create_video_version", {
    video_id: input.data.videoId,
    metadata: input.data.metadata,
  });
  return result.error ? databaseFailure(result.error) : apiResponse({ version: result.data }, 201);
}
