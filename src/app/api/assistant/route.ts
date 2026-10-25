import { apiResponse } from "@/features/auth/guard";
import { isSameOrigin, readBoundedJson } from "@/features/auth/request";
import { assistantInputSchema } from "@/features/assistant/schema";
import { askAssistant } from "@/features/assistant/service";
import { refineAssistantQuery } from "@/features/assistant/query";
import { serializeDiscoveryQuery } from "@/features/discovery/query";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiResponse({ error: "Request origin denied" }, 403);
  const input = assistantInputSchema.safeParse(
    await readBoundedJson(request, 8192).catch(() => null),
  );
  if (!input.success)
    return apiResponse(
      { error: "Enter a message of 1–500 characters and valid discovery filters." },
      400,
    );
  // Separate invalid input from malformed/unavailable public catalog responses.
  try {
    serializeDiscoveryQuery(refineAssistantQuery(input.data.message, input.data.context).query);
  } catch {
    return apiResponse({ error: "Check your filters or duration range." }, 400);
  }
  try {
    return apiResponse(await askAssistant(input.data));
  } catch {
    // Never fall back to demo content if a live service fails.
    return apiResponse({ error: "Catalog unavailable. Try again later." }, 503);
  }
}
