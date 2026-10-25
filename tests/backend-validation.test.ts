import { describe, expect, it } from "vitest";
import { preferenceSchema } from "../src/features/preferences/schema";
import { authInputSchema, isSameOrigin, readBoundedJson } from "../src/features/auth/request";

const genres = ["fantasy", "sci-fi", "comedy", "horror", "animals"];
describe("preference boundary", () => {
  it("allows completion with 5–8 unique genres and optional regions", () => {
    expect(preferenceSchema.safeParse({ status: "completed", genres, regions: [] }).success).toBe(
      true,
    );
    expect(
      preferenceSchema.safeParse({ status: "completed", genres, regions: ["korean"] }).success,
    ).toBe(true);
  });
  it("rejects incomplete, duplicate, unknown and owner-spoofing inputs", () => {
    for (const input of [
      { status: "completed", genres: genres.slice(0, 4), regions: [] },
      { status: "completed", genres: [...genres, ...genres], regions: [] },
      { status: "completed", genres: [...genres.slice(0, 4), "unknown"], regions: [] },
      { status: "completed", genres, regions: [], user_id: "another-user" },
      { status: "completed", genres, regions: ["korean", "korean"] },
      { status: "skipped", genres, regions: [] },
    ])
      expect(preferenceSchema.safeParse(input).success).toBe(false);
  });
  it("skips only with empty selections", () => {
    expect(preferenceSchema.safeParse({ status: "skipped", genres: [], regions: [] }).success).toBe(
      true,
    );
  });
});

describe("account request boundary", () => {
  it("uses the actual browser Host while rejecting cross-origin and forwarded-host spoofing", () => {
    const make = (origin: string, host = "127.0.0.1:3000") =>
      new Request("http://localhost:3000/api/auth", {
        headers: { origin, host, "x-forwarded-host": "evil.test" },
      });
    expect(isSameOrigin(make("http://127.0.0.1:3000"))).toBe(true);
    expect(isSameOrigin(make("http://localhost:3000"))).toBe(false);
    expect(isSameOrigin(make("http://evil.test"))).toBe(false);
    expect(isSameOrigin(make("http://localhost:3000", "evil.test@localhost:3000"))).toBe(false);
  });
  it("does not permit signup role injection or weak passwords", () => {
    expect(
      authInputSchema.safeParse({ action: "signup", email: "user@example.com", password: "tiny" })
        .success,
    ).toBe(false);
    expect(
      authInputSchema.safeParse({
        action: "signup",
        email: "user@example.com",
        password: "long-password-123",
        role: "admin",
      }).success,
    ).toBe(false);
  });
  it("requires an exact same-origin header for cookie mutations", () => {
    expect(
      isSameOrigin(
        new Request("https://aiverse.test/api/auth", {
          headers: { origin: "https://aiverse.test" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request("https://aiverse.test/api/auth", { headers: { origin: "https://evil.test" } }),
      ),
    ).toBe(false);
    expect(isSameOrigin(new Request("https://aiverse.test/api/auth"))).toBe(false);
  });
  it("rejects large JSON before parsing", async () => {
    const request = new Request("https://aiverse.test/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(9000) }),
    });
    await expect(readBoundedJson(request)).rejects.toThrow("Body too large");
  });
});
