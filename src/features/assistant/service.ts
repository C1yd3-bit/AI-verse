import "server-only";
import { catalogMode, discover, findPublicVideo } from "@/features/discovery/service";
import { durationLabel, label, type CatalogVideo } from "@/features/discovery/catalog";
import {
  discoveryQuerySchema,
  searchCatalog,
  serializeDiscoveryQuery,
  type DiscoveryQuery,
} from "@/features/discovery/query";
import {
  assistantInputSchema,
  assistantResponseSchema,
  type AssistantInput,
  type AssistantResponse,
} from "./schema";
import { refineAssistantQuery } from "./query";

function filtersFor(query: DiscoveryQuery) {
  const filters: AssistantResponse["filters"] = [];
  for (const [dimension, title] of [
    ["regions", "Inspiration"],
    ["genres", "Genre"],
    ["formats", "Format"],
    ["languages", "Language"],
    ["keywords", "Keywords"],
    ["hashtags", "Tags"],
  ] as const)
    if (query[dimension].length)
      filters.push({ label: title, value: query[dimension].map(label).join(", ") });
  if (query.minDurationSeconds !== undefined)
    filters.push({ label: "Minimum length", value: durationLabel(query.minDurationSeconds) });
  if (query.maxDurationSeconds !== undefined)
    filters.push({ label: "Maximum length", value: durationLabel(query.maxDurationSeconds) });
  return filters;
}

/** Reasons describe verified public metadata, not a fabricated judgment or viewing history. */
export function reasonFor(video: CatalogVideo) {
  return [
    video.format === "reel" ? "Reel" : "Short film",
    durationLabel(video.duration),
    video.genres.map(label).join(" / "),
    video.regions.length ? `${video.regions.map(label).join(" / ")} inspiration` : "",
    video.languages.length ? `Language: ${video.languages.map(label).join(" / ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function askAssistant(raw: AssistantInput): Promise<AssistantResponse> {
  const input = assistantInputSchema.parse(raw);
  const refinement = refineAssistantQuery(input.message, input.context);
  let query = refinement.query;
  let note = refinement.clarification;
  let source: CatalogVideo | null = null;
  if (refinement.similar) {
    source = input.referenceVideoId ? await findPublicVideo(input.referenceVideoId) : null;
    if (!source || source.status !== "published")
      note = "Choose a public video first, then ask for ‘more like this’.";
    else
      query = discoveryQuerySchema.parse({
        ...query,
        genres: source.genres,
        regions: source.regions,
        formats: [source.format],
      });
  }
  const params = serializeDiscoveryQuery(query);
  const base = {
    query,
    filters: filtersFor(query),
    fusionUrl: `/fusion${params.size ? `?${params}` : ""}`,
    searchUrl: `/search${params.size ? `?${params}` : ""}`,
  };
  if (note)
    return assistantResponseSchema.parse({
      ...base,
      mode: catalogMode(),
      reply: note,
      exact: { total: 0, items: [] },
      broader: {
        label: "Broader suggestions — content region and genre filters relaxed",
        items: [],
      },
      clarification: true,
    });
  params.set("limit", source ? "4" : "3");
  const result = await discover(params);
  // A similar search excludes its source from both cards and the exact total.
  const sourceMatches = source
    ? searchCatalog([source], query, { catalogVersion: "source", limit: 1, broaderLimit: 0 }).exact
        .total
    : 0;
  const total = Math.max(0, result.exact.total - sourceMatches);
  const exactItems = result.exact.items
    .filter((video) => video.status === "published" && video.id !== source?.id)
    .slice(0, 3);
  const broaderItems = result.broader.items
    .filter(
      (video) =>
        video.status === "published" &&
        video.id !== source?.id &&
        !exactItems.some((exact) => exact.id === video.id),
    )
    .slice(0, 2);
  const similarity = query.regions.length
    ? " with shared genre, content inspiration and format"
    : " with shared genre and format";
  const reply = total
    ? `Found ${total} ${result.mode === "demo" ? "demo " : ""}catalog ${total === 1 ? "match" : "matches"}${source ? similarity : ""}.`
    : "No exact catalog matches for these filters. Try changing a filter or removing a length limit.";
  return assistantResponseSchema.parse({
    ...base,
    mode: result.mode,
    reply: `${reply}${broaderItems.length ? " Broader suggestions relax content inspiration and genre; other filters still apply." : ""}`,
    exact: { total, items: exactItems.map((video) => ({ video, reason: reasonFor(video) })) },
    broader: {
      label: "Broader suggestions — content region and genre filters relaxed",
      items: broaderItems.map((video) => ({ video, reason: reasonFor(video) })),
    },
  });
}
