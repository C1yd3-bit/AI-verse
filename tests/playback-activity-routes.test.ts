import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  server: vi.fn(),
  admin: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  config: vi.fn(),
  provider: vi.fn(),
  token: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: m.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: m.admin }));
vi.mock("@/features/media/stream", () => ({
  getStreamConfig: m.config,
  createStreamProvider: m.provider,
}));
import { POST } from "../src/app/api/playback/[id]/progress/route";
// Contract coverage for the inactive Stream adapter. Storage routes are tested separately.
import { GET } from "../src/features/playback/legacy-stream-route";
const account = "82000000-0000-4000-8000-000000000001",
  video = "82000000-0000-4000-8000-000000000002",
  version = "82000000-0000-4000-8000-000000000003",
  key = "82000000-0000-4000-8000-000000000004";
const tracking = { sessionKey: key, accountId: account, versionId: version };
const user = { id: account, email_confirmed_at: "2026-10-24T00:00:00Z" };
const context = { params: Promise.resolve({ id: video }) };
function request(
  body: unknown = { sessionKey: key, watchedSeconds: 30 },
  expected: string | null = account,
  origin = "http://localhost:3000",
) {
  return new Request(`http://localhost:3000/api/playback/${video}/progress`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(expected ? { "x-aiverse-account": expected } : {}),
    },
    body: JSON.stringify(body),
  });
}
const get = () => GET(new Request(`http://localhost:3000/api/playback/${video}`), context);
beforeEach(() => {
  vi.resetAllMocks();
  m.server.mockResolvedValue({ auth: { getUser: m.getUser }, rpc: m.rpc });
  m.getUser.mockResolvedValue({ data: { user }, error: null });
  m.admin.mockReturnValue({ rpc: m.adminRpc });
  m.config.mockReturnValue({});
  m.provider.mockReturnValue({ createPlaybackToken: m.token });
  m.token.mockImplementation(async () => ({
    token: "provider.token.signature",
    expiresAt: Math.floor(Date.now() / 1000) + 80,
  }));
  m.rpc.mockResolvedValue({ data: { watchedSeconds: 30, credited: false }, error: null });
  m.adminRpc.mockImplementation(async (name: string) =>
    name === "playback_entitlement"
      ? {
          data: {
            provider_uid: "a".repeat(32),
            version_id: version,
            duration_seconds: 90,
            public_playback: true,
            expires_at: new Date(Date.now() + 150000).toISOString(),
          },
          error: null,
        }
      : { data: tracking, error: null },
  );
});
describe("thin authenticated playback activity route", () => {
  it("passes long-film progress to the owner/version-bound SQL check without a180-second schema cutoff", async () => {
    m.rpc.mockResolvedValue({ data: { watchedSeconds: 930, credited: true }, error: null });
    const response = await POST(request({ sessionKey: key, watchedSeconds: 930 }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ watchedSeconds: 930, credited: true });
    expect(m.rpc).toHaveBeenCalledWith("record_playback_progress", {
      video_id: video,
      session_key: key,
      watched_seconds: 930,
    });
  });
  it("derives identity from verified auth, requires expected account and returns bounded progress without cache", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ watchedSeconds: 30, credited: false });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("record_playback_progress", {
      video_id: video,
      session_key: key,
      watched_seconds: 30,
    });
  });
  it("rejects foreign origin before authenticating and missing/changed accounts before writes", async () => {
    expect(
      (await POST(request(undefined, account, "https://foreign.example"), context)).status,
    ).toBe(403);
    expect(m.server).not.toHaveBeenCalled();
    for (const id of [null, version])
      expect((await POST(request(undefined, id), context)).status).toBe(409);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rejects missing/unverified authentication", async () => {
    m.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await POST(request(), context)).status).toBe(401);
    m.getUser.mockResolvedValueOnce({
      data: { user: { ...user, email_confirmed_at: null } },
      error: null,
    });
    expect((await POST(request(), context)).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { sessionKey: key, watchedSeconds: 0 },
    { sessionKey: key, watchedSeconds: 1201 },
    { sessionKey: key, watchedSeconds: 1.5 },
    { sessionKey: key, watchedSeconds: 30, userId: account },
    { sessionKey: "invalid", watchedSeconds: 1 },
    { sessionKey: key, watchedSeconds: 30, versionId: version },
    { blob: "x".repeat(1100) },
  ])("rejects invalid, extra, or oversized activity %#", async (body) => {
    expect((await POST(request(body), context)).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rejects a malformed target and unexpected RPC projection", async () => {
    expect((await POST(request(), { params: Promise.resolve({ id: "bad" }) })).status).toBe(400);
    m.rpc.mockResolvedValue({
      data: { watchedSeconds: 30, credited: false, provider_uid: "private" },
      error: null,
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
  it("returns only safe errors for session denial or invalid timing", async () => {
    for (const [code, status] of [
      ["42501", 403],
      ["22023", 400],
      ["private", 409],
    ]) {
      m.rpc.mockResolvedValue({ data: null, error: { code, message: "private failure" } });
      const response = await POST(request(), context);
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).not.toContain("private failure");
    }
  });
});
describe("post-provider public playback session admission", () => {
  it("requests the full930-second film window and preserves the original absolute expiry", async () => {
    const expiry = Math.floor(Date.now() / 1000) + 990;
    m.adminRpc.mockImplementation(async (name: string) =>
      name === "playback_entitlement"
        ? {
            data: {
              provider_uid: "a".repeat(32),
              version_id: version,
              duration_seconds: 930,
              public_playback: true,
              expires_at: new Date(expiry * 1000).toISOString(),
            },
            error: null,
          }
        : { data: tracking, error: null },
    );
    m.token.mockResolvedValue({ token: "provider.token.signature", expiresAt: expiry });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).durationSeconds).toBe(930);
    expect(m.token.mock.calls[0][1]).toBeGreaterThan(980);
    expect(m.token.mock.calls[0][1]).toBeLessThanOrEqual(990);
    expect(m.token.mock.calls[0][2]).toBe(expiry);
  });
  it.each([0, 1201, Number.NaN, null])(
    "denies malformed duration%s before contacting the provider",
    async (duration) => {
      m.adminRpc.mockResolvedValue({
        data: {
          provider_uid: "a".repeat(32),
          version_id: version,
          duration_seconds: duration,
          expires_at: new Date(Date.now() + 120000).toISOString(),
        },
        error: null,
      });
      expect((await get()).status).toBe(404);
      expect(m.token).not.toHaveBeenCalled();
    },
  );
  it("does not track an explicit revision preview even if that revision is also public", async () => {
    const response = await GET(
      new Request(`http://localhost:3000/api/playback/${video}?version=${version}`),
      context,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).tracking).toBeNull();
    expect(m.adminRpc).toHaveBeenCalledTimes(2);
  });
  it("keeps authorized playback available without tracking when session storage throws", async () => {
    const original = m.adminRpc.getMockImplementation()!;
    m.adminRpc.mockImplementation((name: string, args: unknown) =>
      name === "open_playback_session"
        ? Promise.reject(new Error("private session failure"))
        : original(name, args),
    );
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).tracking).toBeNull();
  });
  it("opens a session only after token issuance and final exact-version recheck", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value).toMatchObject({ versionId: version, durationSeconds: 90, tracking });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.adminRpc.mock.calls.map(([name]) => name)).toEqual([
      "playback_entitlement",
      "playback_entitlement",
      "open_playback_session",
    ]);
    expect(m.token.mock.invocationCallOrder[0]).toBeLessThan(
      m.adminRpc.mock.invocationCallOrder[1],
    );
    expect(m.adminRpc.mock.calls[2][1]).toMatchObject({
      viewer_id: account,
      video_id: video,
      version_id: version,
    });
  });
  it.each(["guest", "unverified", "preview"])(
    "returns no tracking for %s while preserving authorized playback",
    async (condition) => {
      if (condition === "guest") m.getUser.mockResolvedValue({ data: { user: null }, error: null });
      if (condition === "unverified")
        m.getUser.mockResolvedValue({
          data: { user: { ...user, email_confirmed_at: null } },
          error: null,
        });
      if (condition === "preview")
        m.adminRpc.mockImplementation(async () => ({
          data: {
            provider_uid: "a".repeat(32),
            version_id: version,
            duration_seconds: 90,
            public_playback: false,
            expires_at: new Date(Date.now() + 150000).toISOString(),
          },
          error: null,
        }));
      const response = await get();
      expect(response.status).toBe(200);
      expect((await response.json()).tracking).toBeNull();
      expect(m.adminRpc).toHaveBeenCalledTimes(2);
    },
  );
  it("does not admit a session on token failure or final visibility/version failure", async () => {
    m.token.mockRejectedValueOnce(new Error("private"));
    expect((await get()).status).toBe(502);
    expect(m.adminRpc).toHaveBeenCalledTimes(1);
    m.adminRpc.mockClear();
    m.adminRpc
      .mockResolvedValueOnce({
        data: {
          provider_uid: "a".repeat(32),
          version_id: version,
          duration_seconds: 90,
          expires_at: new Date(Date.now() + 150000).toISOString(),
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    expect((await get()).status).toBe(404);
    expect(m.adminRpc).toHaveBeenCalledTimes(2);
  });
  it("fails tracking closed for quota/DB denial or cross-owner/version projection", async () => {
    for (const data of [
      null,
      { ...tracking, accountId: version },
      { ...tracking, versionId: account },
      { ...tracking, extra: "private" },
    ]) {
      m.adminRpc.mockImplementation(async (name: string) =>
        name === "open_playback_session"
          ? { data, error: null }
          : {
              data: {
                provider_uid: "a".repeat(32),
                version_id: version,
                duration_seconds: 90,
                public_playback: true,
                expires_at: new Date(Date.now() + 150000).toISOString(),
              },
              error: null,
            },
      );
      const response = await get();
      expect(response.status).toBe(200);
      expect((await response.json()).tracking).toBeNull();
    }
  });
});
