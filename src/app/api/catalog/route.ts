import { discover } from "@/features/discovery/service";
import { apiResponse } from "@/features/auth/guard";
export async function GET(request: Request) {
  try {
    return apiResponse(await discover(new URL(request.url).searchParams));
  } catch (error) {
    const unavailable = error instanceof Error && /unavailable|not configured/.test(error.message);
    return apiResponse(
      {
        error: unavailable
          ? "Catalog unavailable. Try again later."
          : "Check your filters or restart discovery.",
      },
      unavailable ? 503 : 400,
    );
  }
}
