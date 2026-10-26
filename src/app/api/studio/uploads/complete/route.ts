import { z } from "zod";
import { requireAccount, apiResponse } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
export const maxDuration = 120;
const input = z.object({ reservationId: z.uuid(), versionId: z.uuid() }).strict();
const completed = z
  .object({
    accountId: z.uuid(),
    versionId: z.uuid(),
    reservationId: z.uuid(),
    status: z.literal("pending_review"),
  })
  .strict();
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  if (request.headers.get("x-aiverse-account") !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the studio." }, 409);
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before uploading." }, 403);
  const parsed = input.safeParse(await readBoundedJson(request, 1024).catch(() => null));
  if (!parsed.success) return apiResponse({ error: "Invalid upload revision." }, 400);
  const result = await auth.client.functions.invoke("media-storage", {
    body: { action: "complete", ...parsed.data },
  });
  if (result.error) {
    const status = result.error.context instanceof Response ? result.error.context.status : 503;
    return apiResponse(
      {
        error:
          status === 422
            ? "The file must be a complete H.264 MP4 within the size and duration limits. Check the upload, then try completion again."
            : "The uploaded file could not be confirmed. Check status before trying completion again.",
      },
      [401, 403, 404, 409, 422].includes(status) ? status : 503,
    );
  }
  const value = completed.safeParse(result.data);
  if (
    !value.success ||
    value.data.accountId !== auth.user.id ||
    value.data.versionId !== parsed.data.versionId ||
    value.data.reservationId !== parsed.data.reservationId
  )
    return apiResponse({ error: "Upload completion could not be confirmed. Refresh status." }, 409);
  return apiResponse(value.data);
}
