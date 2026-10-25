import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { appealInput } from "@/features/trust/schema";
export async function GET() {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  const [suspensions, appeals] = await Promise.all([
    auth.client
      .from("creator_suspensions")
      .select("id,active,reason,created_at")
      .eq("creator_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    auth.client
      .from("creator_appeals")
      .select("id,suspension_id,statement,status,decision_reason,created_at")
      .eq("creator_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const error = suspensions.error || appeals.error;
  return error
    ? databaseFailure(error)
    : apiResponse({ suspensions: suspensions.data, appeals: appeals.data });
}
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  const input = appealInput.safeParse(await readBoundedJson(request).catch(() => null));
  if (!input.success)
    return apiResponse(
      { error: "Choose a suspension and explain your appeal in 20–3000 characters." },
      400,
    );
  const result = await auth.client.rpc("submit_appeal", {
    suspension_id: input.data.suspensionId,
    statement: input.data.statement,
  });
  return result.error
    ? databaseFailure(result.error)
    : apiResponse({ ok: true, id: result.data }, 201);
}
