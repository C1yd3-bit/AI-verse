import {
  discoveryQuerySchema,
  parseNaturalLanguageQuery,
  type DiscoveryQuery,
} from "@/features/discovery/query";

const arrays = ["keywords", "regions", "genres", "formats", "languages", "hashtags"] as const;
const empty = () => discoveryQuerySchema.parse({});
const clarification =
  "Try a genre, content inspiration, language, format or duration, such as ‘comedy reels under 2 minutes’.";

/** Stateless refinements use only explicit catalog filters, never personal attributes. */
export function refineAssistantQuery(message: string, context?: DiscoveryQuery) {
  const previous = discoveryQuerySchema.parse(context ?? {});
  let text = message.normalize("NFKC").toLocaleLowerCase("en-US").trim();
  if (/^(?:clear|reset|start over)(?: (?:all|filters|everything))?[.!?]*$/.test(text))
    return { query: empty(), similar: false };
  const similar = /\bmore like (?:this|that)\b/.test(text);
  text = text.replace(/\bmore like (?:this|that)\b/g, " ");
  if (
    similar &&
    text
      .replace(
        /\b(?:please|show me|can you|could you|i want|i'd like|find|watch|videos?|content|instead)\b/g,
        " ",
      )
      .replace(/[^\p{L}\p{N}#]/gu, "").length
  )
    return {
      query: previous,
      similar: false,
      clarification:
        "Ask for ‘more like this’ first, then refine the returned filters in a separate message.",
    };
  const next = { ...previous };
  let explicit = similar;
  for (const [pattern, dimension] of [
    [/\bany genre\b/g, "genres"],
    [/\bany (?:content )?inspiration\b/g, "regions"],
    [/\bany language\b/g, "languages"],
    [/\ball formats\b/g, "formats"],
    [/\b(?:clear|no) keywords\b/g, "keywords"],
  ] as const) {
    if (pattern.test(text)) {
      next[dimension] = [];
      text = text.replace(pattern, " ");
      explicit = true;
    }
  }
  if (/\bno length limit\b/.test(text)) {
    delete next.minDurationSeconds;
    delete next.maxDurationSeconds;
    text = text.replace(/\bno length limit\b/g, " ");
    explicit = true;
  }
  if (/\bshorter\b/.test(text)) {
    const bound =
      previous.maxDurationSeconds === undefined
        ? 119
        : Math.max(0, Math.floor(previous.maxDurationSeconds * 0.75));
    if (previous.minDurationSeconds !== undefined && previous.minDurationSeconds > bound)
      return {
        query: previous,
        similar: false,
        clarification:
          "Your minimum duration conflicts with a shorter limit. Try ‘no length limit’, then choose a new duration.",
      };
    next.maxDurationSeconds = bound;
    text = text.replace(/\bshorter\b/g, " ");
    explicit = true;
  }
  // These are conversational glue, not searchable title words in a refinement.
  text = text.replace(
    /\b(?:instead|more(?!\s+than\b)|only|actually|make it|change to|switch to|what about|how about|can you|could you|give me|show me|i want|i'd like|recommend|suggest|something|some|is there|are there|any)\b/g,
    " ",
  );
  if (/\b(?:not|without|except|exclude|excluding|no|anything but)\b/.test(text))
    return {
      query: previous,
      similar: false,
      clarification:
        "Exclusions are not supported yet. Choose the genres you want to include, or clear a filter.",
    };
  if (
    /\b(?:weather|my account|my ethnicity|my password)\b/.test(text) ||
    /^(?:why|how|who|when|help|hello|hi|thanks|thank you|yes|no|tell me|write|generate|translate|summari[sz]e|save (?:this|the|my) (?:mix|fusion)|open this|change it|different|else|try again|surprise me)\b/.test(
      text.trim(),
    )
  )
    return { query: previous, similar: false, clarification };
  const parsed = parseNaturalLanguageQuery(text);
  let recognized = explicit;
  for (const dimension of arrays) {
    if (parsed[dimension].length) {
      next[dimension] = parsed[dimension];
      recognized = true;
    }
  }
  // Incidental ‘any’ is conversational glue; explicit any inspiration was handled above.
  if (/\bglobal\b/.test(text)) {
    next.regions = [];
    recognized = true;
  }
  if (parsed.minDurationSeconds !== undefined) {
    next.minDurationSeconds = parsed.minDurationSeconds;
    recognized = true;
  }
  if (parsed.maxDurationSeconds !== undefined) {
    next.maxDurationSeconds = parsed.maxDurationSeconds;
    recognized = true;
  }
  const valid = discoveryQuerySchema.safeParse(next);
  if (!valid.success)
    return {
      query: previous,
      similar: false,
      clarification:
        "Those duration limits conflict. Choose a compatible range or say ‘no length limit’.",
    };
  if (!recognized) return { query: previous, similar: false, clarification };
  return { query: valid.data, similar };
}
