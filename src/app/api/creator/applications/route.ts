import { z } from "zod";
import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";

const applicationSchema = z
  .object({
    display_name: z.string().trim().min(1).max(80),
    handle: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,29}$/),
    bio: z.string().trim().min(1).max(2000),
    portfolio_url: z.url().refine((value) => new URL(value).protocol === "https:"),
    rights_attested: z.literal(true),
  })
  .strict();
export async function GET(request: Request) {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  // Comparison only: verified cookie identity and SQL authorization remain authoritative.
  const expectedAccount = request.headers.get("x-aiverse-account");
  if (expectedAccount !== null && expectedAccount !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the studio." }, 409);
  const result = await auth.client
    .from("creator_applications")
    .select("id,application,status,decision_reason,created_at,decided_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  return result.error ? databaseFailure(result.error) : apiResponse({ applications: result.data });
}
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  // Comparison only: verified cookie identity and SQL authorization remain authoritative.
  const expectedAccount = request.headers.get("x-aiverse-account");
  if (expectedAccount !== null && expectedAccount !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the studio." }, 409);
  const input = applicationSchema.safeParse(await readBoundedJson(request).catch(() => null));
  if (!input.success)
    return apiResponse(
      { error: "Check your name, handle, biography, HTTPS portfolio and rights declaration." },
      400,
    );
  const result = await auth.client.rpc("submit_creator_application", { application: input.data });
  return result.error
    ? databaseFailure(result.error)
    : apiResponse({ applicationId: result.data }, 201);
}
