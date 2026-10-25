import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: createClient }));
import {
  POST as savePreferences,
  GET as readPreferences,
} from "../src/app/api/me/preferences/route";
import { POST as accountRequest } from "../src/app/api/auth/route";

const genres = ["fantasy", "sci-fi", "comedy", "horror", "animals"];
function request(path: string, body: unknown, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("server account and preference contracts", () => {
  beforeEach(() => {
    createClient.mockReset();
  });
  it("does not create a demo identity when Supabase is absent", async () => {
    createClient.mockResolvedValue(null);
    expect(
      (
        await savePreferences(
          request("/api/me/preferences", { status: "completed", genres, regions: [] }),
        )
      ).status,
    ).toBe(503);
    expect((await readPreferences()).status).toBe(503);
    expect(
      (
        await accountRequest(
          request("/api/auth", {
            action: "login",
            email: "user@example.com",
            password: "demo-password",
          }),
        )
      ).status,
    ).toBe(503);
  });
  it("rejects unauthenticated preference writes before touching storage", async () => {
    const rpc = vi.fn();
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      rpc,
    });
    expect(
      (
        await savePreferences(
          request("/api/me/preferences", { status: "completed", genres, regions: [] }),
        )
      ).status,
    ).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes only validated preferences to owner-derived SQL RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "verified-user" } }, error: null }) },
      rpc,
    });
    expect(
      (
        await savePreferences(
          request("/api/me/preferences", { status: "completed", genres, regions: ["korean"] }),
        )
      ).status,
    ).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_viewer_preferences", {
      preference_status: "completed",
      genre_slugs: genres,
      region_slugs: ["korean"],
    });
    rpc.mockClear();
    expect(
      (
        await savePreferences(
          request("/api/me/preferences", {
            status: "completed",
            genres,
            regions: [],
            user_id: "victim",
          }),
        )
      ).status,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("denies cross-origin cookie mutations before provider operations", async () => {
    const malicious = "https://evil.test";
    expect(
      (
        await savePreferences(
          request("/api/me/preferences", { status: "skipped", genres: [], regions: [] }, malicious),
        )
      ).status,
    ).toBe(403);
    expect(
      (await accountRequest(request("/api/auth", { action: "logout" }, malicious))).status,
    ).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });
});
