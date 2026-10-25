import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { preferenceSchema } from "@/features/preferences/schema";
import { isSameOrigin, readBoundedJson } from "@/features/auth/request";

async function identity() {
  const client = await createSupabaseServerClient();
  if (!client)
    return {
      response: NextResponse.json(
        { error: "Account preferences are not configured" },
        { status: 503 },
      ),
    };
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user)
    return {
      response: NextResponse.json(
        { error: "Sign in to save account preferences" },
        { status: 401 },
      ),
    };
  return { client, user };
}

export async function GET() {
  const auth = await identity();
  if (auth.response) return auth.response;
  const { data, error } = await auth.client
    .from("viewer_preferences")
    .select("status,genres,regions")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load preferences" }, { status: 502 });
  return NextResponse.json(
    { preferences: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return NextResponse.json({ error: "Request origin denied" }, { status: 403 });
  const auth = await identity();
  if (auth.response) return auth.response;
  let input;
  try {
    input = preferenceSchema.safeParse(await readBoundedJson(request));
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!input.success)
    return NextResponse.json(
      {
        error:
          "Choose 5–8 unique genres, or skip with no selections. Content regions are optional.",
      },
      { status: 400 },
    );
  const { error } = await auth.client.rpc("save_viewer_preferences", {
    preference_status: input.data.status,
    genre_slugs: input.data.genres,
    region_slugs: input.data.regions,
  });
  if (error) return NextResponse.json({ error: "Could not save preferences" }, { status: 502 });
  return NextResponse.json({ ok: true, preferences: input.data });
}
