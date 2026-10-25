import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { reportInput } from "@/features/trust/schema";
export async function GET() {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  const result = await auth.client
    .from("video_reports")
    .select("id,video_id,category,details,status,resolution_reason,created_at")
    .eq("reporter_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return result.error ? databaseFailure(result.error) : apiResponse({ reports: result.data });
}
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  const input = reportInput.safeParse(await readBoundedJson(request).catch(() => null));
  if (!input.success)
    return apiResponse(
      { error: "Choose a report category and describe the issue in 5–2000 characters." },
      400,
    );
  const result = await auth.client.rpc("submit_video_report", {
    video_id: input.data.videoId,
    category: input.data.category,
    details: input.data.details,
  });
  return result.error
    ? databaseFailure(result.error)
    : apiResponse({ ok: true, id: result.data }, 201);
}
