import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), config: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: m.client }));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: m.config }));
import { GET, POST } from "../src/app/api/me/profile/route";
const user = {
  id: "93000000-0000-4000-8000-000000000001",
  email: "verified@example.test",
  email_confirmed_at: "2026-10-24T00:00:00Z",
  user_metadata: { email: "spoof@example.test", role: "admin" },
};
const basics = { fullName: "Private Name", age: 29, contactNumber: null };
const snapshot = () => ({
  account: { ...basics, completedAt: "2026-10-24T00:00:00Z" },
  appearance: { theme: "dark" },
  creator: { approved: false, suspended: false, applicationStatus: null },
  stats: { total: 0, published: 0, pendingReview: 0, drafts: 0, likes: 0, creditedCompletions: 0 },
  content: [],
});
function request(
  value: unknown,
  origin = "http://localhost:3000",
  accountId: string | null = user.id,
) {
  return new Request("http://localhost:3000/api/me/profile", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(accountId ? { "x-aiverse-account": accountId } : {}),
    },
    body: JSON.stringify(value),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  m.client.mockResolvedValue({ auth: { getUser: m.getUser }, rpc: m.rpc });
  m.getUser.mockResolvedValue({ data: { user }, error: null });
  m.rpc.mockResolvedValue({ data: snapshot(), error: null });
  m.config.mockReturnValue(null);
  vi.stubEnv("AIVERSE_ENABLE_STREAM_UPLOADS", "false");
});
afterEach(() => vi.unstubAllEnvs());
describe("verified private profile route", () => {
  it("returns only an allowlisted owner snapshot, trusted email and disabled upload status with no cache", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...snapshot(),
      accountId: user.id,
      account: { ...snapshot().account, email: user.email },
      uploadsAvailable: false,
    });
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("get_my_profile");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("requires real server authentication and verified email before any read or write", async () => {
    m.client.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(503);
    m.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await GET()).status).toBe(401);
    m.getUser.mockResolvedValue({
      data: { user: { ...user, email_confirmed_at: null } },
      error: null,
    });
    expect((await GET()).status).toBe(403);
    expect((await POST(request({ action: "appearance", theme: "light" }))).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("requires same-origin bounded JSON and strict owner-derived updates", async () => {
    for (const value of [
      { action: "appearance", theme: "light", userId: "other" },
      { action: "appearance", theme: "system" },
      { action: "account", ...basics, role: "admin" },
      { action: "account", ...basics, email: "new@example.test" },
      { action: "account", ...basics, ethnicity: "Other" },
      { action: "account", ...basics, fullName: "😀".repeat(41) },
      { action: "account", ...basics, age: 0 },
    ])
      expect((await POST(request(value))).status).toBe(400);
    expect(
      (await POST(request({ action: "appearance", theme: "light" }, "https://foreign.example")))
        .status,
    ).toBe(403);
    expect(
      (await POST(request({ action: "account", ...basics, fullName: "x".repeat(9000) }))).status,
    ).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
    for (const accountId of [null, "93000000-0000-4000-8000-000000000002"]) {
      for (const body of [
        { action: "appearance", theme: "light" },
        { action: "account", ...basics },
      ]) {
        const changed = await POST(request(body, "http://localhost:3000", accountId));
        expect(changed.status).toBe(409);
      }
    }
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue({ data: null, error: null });
    const theme = await POST(request({ action: "appearance", theme: "light" }));
    expect(await theme.json()).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenLastCalledWith("set_my_appearance", { requested_theme: "light" });
    const account = await POST(
      request({ action: "account", ...basics, fullName: "  Updated Name  " }),
    );
    expect(account.status).toBe(200);
    expect(m.rpc).toHaveBeenLastCalledWith("update_my_account_information", {
      payload: { ...basics, fullName: "Updated Name" },
    });
  });
  it("fails closed on backend errors and unexpected or unsafe projection fields", async () => {
    m.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "Private database detail" },
    });
    const error = await GET();
    expect(error.status).toBe(502);
    expect(await error.text()).not.toMatch(/Private database detail/);
    for (const value of [
      { ...snapshot(), provider_uid: "secret" },
      { ...snapshot(), account: { ...snapshot().account, ethnicity: "sensitive" } },
      { ...snapshot(), stats: { ...snapshot().stats, likes: -1 } },
    ]) {
      m.rpc.mockResolvedValueOnce({ data: value, error: null });
      const response = await GET();
      expect(response.status).toBe(502);
      expect(await response.text()).not.toMatch(/secret|sensitive/);
    }
    m.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "Private database detail" },
    });
    const denied = await POST(request({ action: "appearance", theme: "light" }));
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toMatch(/Private database detail/);
  });
  it("preserves missing onboarding and enables Storage from Supabase configuration independently of Stream", async () => {
    m.rpc.mockResolvedValue({ data: { ...snapshot(), account: null }, error: null });
    expect((await (await GET()).json()).account).toBeNull();
    vi.stubEnv("AIVERSE_ENABLE_STREAM_UPLOADS", "true");
    expect((await (await GET()).json()).uploadsAvailable).toBe(false);
    m.config.mockReturnValue({ url: "https://project.supabase.co", key: "public-test-key" });
    expect((await (await GET()).json()).uploadsAvailable).toBe(true);
    vi.stubEnv("AIVERSE_ENABLE_STREAM_UPLOADS", "false");
    expect((await (await GET()).json()).uploadsAvailable).toBe(true);
    m.config.mockReturnValue(null);
    expect((await (await GET()).json()).uploadsAvailable).toBe(false);
  });
});
