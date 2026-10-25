import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { decisionInput } from "@/features/media/schema";

export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  // Comparison only: the verified cookie remains the source of identity.
  const expectedAccount = request.headers.get("x-aiverse-account");
  if (expectedAccount !== null && expectedAccount !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the review queue." }, 409);
  const parsed = decisionInput.safeParse(await readBoundedJson(request).catch(() => null));
  if (!parsed.success)
    return apiResponse({ error: "Choose a decision and give a reason of 5–1000 characters." }, 400);
  const input = parsed.data;
  const result =
    input.kind === "video"
      ? await auth.client.rpc("moderate_video", {
          video_id: input.id,
          action: input.action,
          reason: input.reason,
        })
      : input.kind === "version"
        ? await auth.client.rpc("review_video_version", {
            version_id: input.id,
            approve: input.approve,
            reason: input.reason,
          })
        : await auth.client.rpc("decide_creator_application", {
            application_id: input.id,
            approve: input.approve,
            reason: input.reason,
          });
  return result.error ? databaseFailure(result.error) : apiResponse({ ok: true });
}
