import { describe, expect, it } from "vitest";
import { assistantInputSchema } from "../src/features/assistant/schema";
import { refineAssistantQuery } from "../src/features/assistant/query";
import {
  discoveryQuerySchema,
  parseDiscoveryParams,
  serializeDiscoveryQuery,
} from "../src/features/discovery/query";

const empty = discoveryQuerySchema.parse({});
describe("catalog assistant query refinements", () => {
  it("extracts the supported initial request using existing strict duration semantics", () => {
    expect(refineAssistantQuery("Find Korean romantic reels under 2 minutes").query).toEqual({
      ...empty,
      regions: ["korean"],
      genres: ["romance"],
      formats: ["reel"],
      maxDurationSeconds: 119,
    });
  });
  it("replaces explicit dimensions while retaining the remaining context and round-trips", () => {
    let result = refineAssistantQuery("Korean romantic reels under 2 minutes");
    result = refineAssistantQuery("More comedy instead", result.query);
    expect(result.query).toEqual({
      ...empty,
      regions: ["korean"],
      genres: ["comedy"],
      formats: ["reel"],
      maxDurationSeconds: 119,
    });
    result = refineAssistantQuery("in Tagalog", result.query);
    expect(result.query.languages).toEqual(["tagalog"]);
    expect(result.query.regions).toEqual(["korean"]);
    result = refineAssistantQuery("shorter", result.query);
    expect(result.query.maxDurationSeconds).toBe(89);
    expect(parseDiscoveryParams(serializeDiscoveryQuery(result.query))).toEqual(result.query);
    expect(refineAssistantQuery("shorter").query.maxDurationSeconds).toBe(119);
  });
  it("can explicitly clear each restriction without clearing unrelated dimensions", () => {
    const context = discoveryQuerySchema.parse({
      genres: ["comedy"],
      regions: ["filipino"],
      languages: ["tagalog"],
      formats: ["movie"],
      minDurationSeconds: 30,
      maxDurationSeconds: 180,
      keywords: ["ocean"],
    });
    expect(
      refineAssistantQuery(
        "any genre, any inspiration, any language, all formats, no length limit",
        context,
      ).query,
    ).toEqual({ ...empty, keywords: ["ocean"] });
    expect(refineAssistantQuery("clear keywords", context).query.keywords).toEqual([]);
    for (const message of ["reset", "clear all", "start over!", "clear filters"])
      expect(refineAssistantQuery(message, context).query).toEqual(empty);
  });
  it("keeps inspiration when ‘any’ is conversational rather than an explicit filter reset", () => {
    const context = discoveryQuerySchema.parse({ regions: ["korean"], genres: ["romance"] });
    expect(refineAssistantQuery("Is there any comedy", context).query).toEqual({
      ...empty,
      regions: ["korean"],
      genres: ["comedy"],
    });
    expect(refineAssistantQuery("any inspiration comedy", context).query).toEqual({
      ...empty,
      genres: ["comedy"],
    });
    expect(refineAssistantQuery("global comedy", context).query).toEqual({
      ...empty,
      genres: ["comedy"],
    });
  });
  it("preserves the strict ‘more than’ comparator while discarding refinement glue", () => {
    expect(refineAssistantQuery("more than 2 minutes").query).toEqual({
      ...empty,
      minDurationSeconds: 121,
    });
    expect(refineAssistantQuery("more comedy more than 2 minutes").query).toEqual({
      ...empty,
      genres: ["comedy"],
      minDurationSeconds: 121,
    });
  });
  it("clarifies unsupported exclusions without turning excluded genres into selected filters", () => {
    const context = discoveryQuerySchema.parse({ regions: ["korean"], genres: ["romance"] });
    for (const message of [
      "not horror",
      "comedy without horror",
      "comedy except horror",
      "no horror",
      "anything but horror",
    ]) {
      const result = refineAssistantQuery(message, context);
      expect(result.clarification).toContain("Exclusions");
      expect(result.query).toEqual(context);
    }
  });
  it("does not silently replace explicit mixed similarity refinements with source metadata", () => {
    const context = discoveryQuerySchema.parse({ genres: ["romance"], regions: ["korean"] });
    for (const message of ["more like this comedy", "more like this but comedy"]) {
      const result = refineAssistantQuery(message, context);
      expect(result.clarification).toContain("separate message");
      expect(result.query).toEqual(context);
      expect(result.similar).toBe(false);
    }
    expect(refineAssistantQuery("show me more like this please", context).similar).toBe(true);
  });
  it("preserves actual descriptive keywords and correctly separates inspiration/language", () => {
    expect(refineAssistantQuery("cat cooking spaghetti").query.keywords).toEqual([
      "cat",
      "cooking",
      "spaghetti",
    ]);
    expect(refineAssistantQuery("romance in Korean").query).toEqual({
      ...empty,
      genres: ["romance"],
      languages: ["korean"],
    });
    expect(refineAssistantQuery("#rain #city").query.hashtags).toEqual(["city", "rain"]);
  });
  it("asks for clarification on unsupported conversation and conflicting refinements", () => {
    const context = discoveryQuerySchema.parse({
      genres: ["comedy"],
      minDurationSeconds: 100,
      maxDurationSeconds: 120,
    });
    for (const message of [
      "hello",
      "tell me a joke",
      "write code",
      "my ethnicity",
      "how do you work?",
      "shorter",
      "under 20 seconds",
      "show me something else",
      "try again",
      "save this mix",
    ]) {
      const result = refineAssistantQuery(message, context);
      expect(result.clarification).toBeTruthy();
      expect(result.query).toEqual(context);
    }
    expect(refineAssistantQuery("more like this", context).similar).toBe(true);
    expect(refineAssistantQuery("secret code").query.keywords).toEqual(["code", "secret"]);
  });
  it("strictly bounds messages, contexts and reference identifiers", () => {
    expect(assistantInputSchema.parse({ message: "  comedy  " }).message).toBe("comedy");
    for (const value of [
      { message: " " },
      { message: "x".repeat(501) },
      { message: "ok", role: "admin" },
      { message: "ok", context: { genres: ["invented"] } },
      { message: "ok", context: { owner: "private" } },
      { message: "ok", referenceVideoId: "../../private" },
    ])
      expect(assistantInputSchema.safeParse(value).success).toBe(false);
    expect(
      assistantInputSchema.safeParse({
        message: "more like this",
        referenceVideoId: "one-table-for-two",
      }).success,
    ).toBe(true);
  });
});
