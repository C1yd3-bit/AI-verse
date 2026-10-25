import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseConfig } from "@/lib/env";
import type { CatalogVideo } from "./catalog";
import { parseDiscoveryParams, serializeDiscoveryQuery, type DiscoveryQuery } from "./query";

// Kept as the protocol discriminator for existing public response schemas. An
// environment value can never re-enable synthetic content.
export const catalogMode = (): "live" | "demo" => "live";

export class CatalogUnavailableError extends Error {
  constructor(message = "Published catalog is temporarily unavailable. Please try again shortly.") {
    super(message);
    this.name = "CatalogUnavailableError";
  }
}
const publicRow = z
  .object({
    id: z.uuid(),
    version_id: z.uuid(),
    creator_id: z.uuid(),
    title: z.string(),
    description: z.string(),
    format: z.enum(["reel", "movie"]),
    genres: z.array(z.string()),
    regions: z.array(z.string()),
    languages: z.array(z.string()),
    tags: z.array(z.string()),
    ai_disclosed: z.literal(true),
    published_at: z.string(),
    duration_seconds: z.number().int().positive(),
    has_artwork: z.boolean().optional().default(false),
  })
  .strict();
type PublicRow = z.infer<typeof publicRow>;
const fields =
  "id,version_id,creator_id,title,description,format,genres,regions,languages,tags,ai_disclosed,published_at,duration_seconds,has_artwork";
function asVideo(row: PublicRow): CatalogVideo {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creator: row.creator_id,
    format: row.format,
    duration: row.duration_seconds,
    genres: row.genres,
    regions: row.regions,
    languages: row.languages,
    tags: row.tags,
    artwork: row.has_artwork ? `/api/artwork/${row.version_id}` : "",
    status: "published",
    demo: false,
    publishedAt: row.published_at,
  };
}
function publicClient() {
  const config = getSupabaseConfig();
  if (!config)
    throw new CatalogUnavailableError(
      "Published catalog is not configured yet. Please check back later.",
    );
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)])
            : AbortSignal.timeout(12_000),
        }),
    },
  });
}
async function catalogRequest<T>(request: PromiseLike<T>): Promise<T> {
  try {
    return await request;
  } catch {
    throw new CatalogUnavailableError();
  }
}
function catalogData<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new CatalogUnavailableError();
  return result.data;
}
export async function discover(params: URLSearchParams) {
  const query = parseDiscoveryParams(params);
  const limitValue = params.get("limit") ?? "20";
  if (!/^\d{1,2}$/.test(limitValue)) throw new Error("Invalid page size");
  const limit = z.number().int().min(1).max(50).parse(Number(limitValue));
  const cursor = params.get("cursor") ?? undefined;
  const filterHash = createHash("sha256")
    .update(serializeDiscoveryQuery(query).toString())
    .digest("hex");
  let after: { after: string; revision: string; filterHash: string } | undefined;
  if (cursor) {
    if (cursor.length > 1024) throw new Error("Invalid discovery cursor");
    after = z
      .object({
        after: z.uuid(),
        revision: z.string().regex(/^[a-f0-9]{32}$/),
        filterHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (after.filterHash !== filterHash) throw new Error("Filters changed; restart discovery");
  }
  const result = await catalogRequest(
    publicClient().rpc("discover_catalog", {
      filters: query,
      after_id: after?.after ?? null,
      expected_revision: after?.revision ?? null,
      page_size: limit,
    }),
  );
  if (result.error) {
    if (result.error.code === "22023") throw new Error("Catalog changed; restart discovery");
    throw new CatalogUnavailableError();
  }
  const page = catalogData(
    z.object({
      revision: z.string(),
      exact: z.object({
        items: z.array(publicRow),
        total: z.number(),
        nextId: z.uuid().nullable(),
      }),
      broader: z.object({ label: z.string(), items: z.array(publicRow) }),
    }),
    result.data,
  );
  return {
    mode: catalogMode(),
    query,
    exact: {
      items: page.exact.items.map(asVideo),
      total: page.exact.total,
      nextCursor: page.exact.nextId
        ? Buffer.from(
            JSON.stringify({ after: page.exact.nextId, revision: page.revision, filterHash }),
          ).toString("base64url")
        : null,
    },
    broader: { label: page.broader.label, items: page.broader.items.map(asVideo) },
  };
}
export async function findPublicVideo(id: string): Promise<CatalogVideo | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const result = await catalogRequest(
    publicClient().from("public_catalog").select(fields).eq("id", id).maybeSingle(),
  );
  if (result.error) throw new CatalogUnavailableError();
  return result.data ? asVideo(catalogData(publicRow, result.data)) : null;
}
export function toSearchParams(params: Record<string, string | string[] | undefined>) {
  const result = new URLSearchParams();
  for (const [key, values] of Object.entries(params))
    for (const value of typeof values === "string" ? [values] : (values ?? []))
      result.append(key, value);
  return result;
}
export function nextDiscoveryUrl(path: string, query: DiscoveryQuery, cursor: string) {
  const params = serializeDiscoveryQuery(query);
  params.set("cursor", cursor);
  return `${path}?${params}`;
}
export async function publicCollection({
  creatorId,
  tag,
  after,
}: {
  creatorId?: string;
  tag?: string;
  after?: string;
}) {
  if (after && !z.uuid().safeParse(after).success) throw new Error("Invalid collection cursor");
  if (creatorId && !z.uuid().safeParse(creatorId).success)
    return { creator: null, items: [], nextId: null };
  if (tag && !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u.test(tag))
    return { creator: null, items: [], nextId: null };
  const client = publicClient();
  const profile = creatorId
    ? await catalogRequest(
        client
          .from("public_creators")
          .select("id,display_name,handle,bio")
          .eq("id", creatorId)
          .maybeSingle(),
      )
    : null;
  if (profile?.error) throw new CatalogUnavailableError();
  let request = client.from("public_catalog").select(fields).order("id").limit(21);
  if (creatorId) request = request.eq("creator_id", creatorId);
  if (tag) request = request.contains("tags", [tag]);
  if (after) request = request.gt("id", after);
  const result = await catalogRequest(request);
  if (result.error) throw new CatalogUnavailableError();
  const rows = catalogData(z.array(publicRow), result.data);
  const creator = profile?.data
    ? catalogData(
        z.object({ id: z.uuid(), display_name: z.string(), handle: z.string(), bio: z.string() }),
        profile.data,
      )
    : null;
  return {
    creator,
    items: rows.slice(0, 20).map(asVideo),
    nextId: rows.length > 20 ? rows[19].id : null,
  };
}
