import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOrigin } from "./request";

export function apiResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
export async function requireAccount(request?: Request) {
  if (request && !isSameOrigin(request))
    return { response: apiResponse({ error: "Request origin denied" }, 403) };
  const client = await createSupabaseServerClient();
  if (!client)
    return { response: apiResponse({ error: "Account services are not configured" }, 503) };
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { response: apiResponse({ error: "Sign in to continue" }, 401) };
  return { client, user: data.user };
}
export function databaseFailure(error: { code?: string } | null) {
  const status = error?.code === "42501" ? 403 : error?.code === "22023" ? 400 : 409;
  return apiResponse(
    {
      error:
        "The action could not be completed. Refresh and check your access or the current status.",
    },
    status,
  );
}
