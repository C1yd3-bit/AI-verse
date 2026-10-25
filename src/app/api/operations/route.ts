import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { operationInput } from "@/features/trust/schema";
export async function GET() {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  const role = await auth.client.from("user_roles").select("role").eq("user_id", auth.user.id);
  if (role.error) return databaseFailure(role.error);
  const roles = role.data.map((item) => item.role);
  const admin = roles.includes("admin");
  if (!admin && !roles.includes("moderator"))
    return apiResponse({ error: "Moderator access required" }, 403);
  const [reports, appeals, summary] = await Promise.all([
    auth.client
      .from("video_reports")
      .select("id,video_id,category,details,status,created_at")
      .eq("status", "pending")
      .order("created_at")
      .limit(50),
    admin
      ? auth.client
          .from("creator_appeals")
          .select("id,creator_id,suspension_id,statement,status,created_at")
          .eq("status", "pending")
          .order("created_at")
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
    admin ? auth.client.rpc("ops_summary") : Promise.resolve({ data: null, error: null }),
  ]);
  const error = reports.error || appeals.error || summary.error;
  return error
    ? databaseFailure(error)
    : apiResponse({ roles, reports: reports.data, appeals: appeals.data, summary: summary.data });
}
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  const parsed = operationInput.safeParse(await readBoundedJson(request).catch(() => null));
  if (!parsed.success)
    return apiResponse({ error: "Check the decision, IDs, limits, expiry and reason." }, 400);
  const value = parsed.data;
  const result =
    value.action === "resolve_report"
      ? await auth.client.rpc("resolve_video_report", {
          report_id: value.id,
          resolution: value.resolution,
          reason: value.reason,
        })
      : value.action === "suspend"
        ? await auth.client.rpc("set_creator_suspension", {
            creator_id: value.creatorId,
            suspended: value.suspended,
            reason: value.reason,
          })
        : value.action === "resolve_appeal"
          ? await auth.client.rpc("resolve_appeal", {
              appeal_id: value.id,
              approved: value.approved,
              reason: value.reason,
            })
          : await auth.client.rpc("set_quota_override", {
              creator_id: value.creatorId,
              daily_uploads: value.dailyUploads,
              monthly_seconds: value.monthlySeconds,
              expires_at: value.expiresAt,
              reason: value.reason,
            });
  return result.error ? databaseFailure(result.error) : apiResponse({ ok: true });
}
