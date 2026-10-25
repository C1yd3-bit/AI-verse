import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  client: vi.fn(),
  settings: vi.fn(),
  config: vi.fn(),
  signUp: vi.fn(),
  signIn: vi.fn(),
  verify: vi.fn(),
  resend: vi.fn(),
  signOut: vi.fn(),
  oauth: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  exchange: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: m.client }));
vi.mock("@/features/auth/settings", () => ({ getAuthProviderSettings: m.settings }));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: m.config }));
import { POST as account } from "../src/app/api/auth/route";
import { GET as google } from "../src/app/api/auth/google/route";
import { GET as callback } from "../src/app/auth/callback/route";
import { GET as profile, POST as complete } from "../src/app/api/me/onboarding/route";
const id = "a0000000-0000-4000-8000-000000000001";
const user = { id, email_confirmed_at: "2026-10-24T00:00:00Z" };
const data = {
  fullName: "Private Test Name",
  age: 25,
  contactNumber: null,
  preferences: {
    status: "completed",
    genres: ["fantasy", "sci-fi", "comedy", "horror", "animals"],
    regions: [],
  },
  ethnicity: null,
  ethnicityConsent: false,
};
function request(body: unknown, path = "/api/auth", origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  const builder = { select: vi.fn().mockReturnThis(), eq: m.eq, maybeSingle: m.maybeSingle };
  m.eq.mockReturnValue(builder);
  m.maybeSingle.mockResolvedValue({ data: null, error: null });
  m.from.mockReturnValue(builder);
  m.client.mockResolvedValue({
    auth: {
      signUp: m.signUp,
      signInWithPassword: m.signIn,
      verifyOtp: m.verify,
      resend: m.resend,
      signOut: m.signOut,
      signInWithOAuth: m.oauth,
      getUser: m.getUser,
      exchangeCodeForSession: m.exchange,
    },
    from: m.from,
    rpc: m.rpc,
  });
  m.settings.mockResolvedValue({ emailConfirmation: true, google: false });
  m.config.mockReturnValue({ url: "http://127.0.0.1:55321", key: "public-test-key-only-not-used" });
  m.signUp.mockResolvedValue({
    data: { session: null, user: { id, email_confirmed_at: null } },
    error: null,
  });
  m.signIn.mockResolvedValue({ data: { session: {}, user }, error: null });
  m.verify.mockResolvedValue({ data: { session: {}, user }, error: null });
  m.signOut.mockResolvedValue({ error: null });
  m.resend.mockResolvedValue({ error: null });
  m.getUser.mockResolvedValue({ data: { user }, error: null });
  m.rpc.mockResolvedValue({ data: null, error: null });
  m.exchange.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe("email signup and verification", () => {
  it("requires confirmation without creating an onboarding session", async () => {
    const response = await account(
      request({ action: "signup", email: "test@example.com", password: "long-test-password" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, confirmationRequired: true });
    expect(m.from).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects unsafe automatic confirmation before signup and signs out unexpected upstream sessions", async () => {
    m.settings.mockResolvedValueOnce({ emailConfirmation: false, google: false });
    expect(
      (
        await account(
          request({ action: "signup", email: "test@example.com", password: "long-test-password" }),
        )
      ).status,
    ).toBe(503);
    expect(m.signUp).not.toHaveBeenCalled();
    m.signUp.mockResolvedValueOnce({ data: { session: {}, user }, error: null });
    expect(
      (
        await account(
          request({ action: "signup", email: "test@example.com", password: "long-test-password" }),
        )
      ).status,
    ).toBe(503);
    expect(m.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("verifies six digits through Supabase and sends unfinished users to onboarding", async () => {
    const response = await account(
      request({ action: "verify_signup", email: "test@example.com", code: "123456" }),
    );
    expect(await response.json()).toEqual({
      ok: true,
      confirmationRequired: false,
      next: "/onboarding",
    });
    expect(m.verify).toHaveBeenCalledExactlyOnceWith({
      email: "test@example.com",
      token: "123456",
      type: "email",
    });
  });
  it("does not accept invalid codes, expired provider codes or unverified results", async () => {
    expect(
      (await account(request({ action: "verify_signup", email: "test@example.com", code: "123" })))
        .status,
    ).toBe(400);
    expect(m.verify).not.toHaveBeenCalled();
    m.verify.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { status: 400, message: "sensitive provider token" },
    });
    const expired = await account(
      request({ action: "verify_signup", email: "test@example.com", code: "123456" }),
    );
    expect(expired.status).toBe(400);
    expect(JSON.stringify(await expired.json())).not.toContain("sensitive provider token");
    m.verify.mockResolvedValueOnce({
      data: { session: {}, user: { id, email_confirmed_at: null } },
      error: null,
    });
    expect(
      (
        await account(
          request({ action: "verify_signup", email: "test@example.com", code: "123456" }),
        )
      ).status,
    ).toBe(403);
    expect(m.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("relies on Supabase resend limits and never returns a code", async () => {
    m.resend.mockResolvedValueOnce({ error: { status: 429, message: "provider detail" } });
    const limited = await account(request({ action: "resend_signup", email: "test@example.com" }));
    expect(limited.status).toBe(429);
    const response = await account(request({ action: "resend_signup", email: "test@example.com" }));
    expect(await response.json()).toEqual({ ok: true, confirmationRequired: true });
    expect(m.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "test@example.com",
      options: { emailRedirectTo: "http://localhost:3000/auth/callback" },
    });
  });
  it("routes a completed confirmed account to dashboard and ignores arbitrary callback destinations", async () => {
    m.maybeSingle.mockResolvedValue({
      data: { completed_at: "2026-10-24T00:00:00Z" },
      error: null,
    });
    const login = await account(
      request({ action: "login", email: "test@example.com", password: "long-test-password" }),
    );
    expect((await login.json()).next).toBe("/dashboard");
    const redirect = await callback(
      new Request(
        "http://localhost:3000/auth/callback?code=opaque-test-code&next=https://other.test",
      ),
    );
    expect(redirect.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });
  it("routes verified PKCE callbacks to onboarding for incomplete accounts", async () => {
    const response = await callback(
      new Request("http://localhost:3000/auth/callback?code=opaque-test-code"),
    );
    expect(response.headers.get("location")).toBe("http://localhost:3000/onboarding");
    expect(m.exchange).toHaveBeenCalledWith("opaque-test-code");
  });
});
describe("Google readiness and safe PKCE", () => {
  it("reports Google unavailable honestly without starting fake OAuth", async () => {
    const response = await google(new Request("http://localhost:3000/api/auth/google"));
    expect(response.status).toBe(503);
    expect(m.oauth).not.toHaveBeenCalled();
  });
  it("uses only the constant callback and rejects external authorization URLs", async () => {
    m.settings.mockResolvedValue({ emailConfirmation: true, google: true });
    m.oauth.mockResolvedValueOnce({
      data: { url: "http://127.0.0.1:55321/auth/v1/authorize?provider=google" },
      error: null,
    });
    const allowed = await google(
      new Request("http://localhost:3000/api/auth/google?next=https://other.test"),
    );
    expect(allowed.status).toBe(307);
    expect(m.oauth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/auth/callback", skipBrowserRedirect: true },
    });
    m.oauth.mockResolvedValueOnce({ data: { url: "https://other.test/authorize" }, error: null });
    expect((await google(new Request("http://localhost:3000/api/auth/google"))).status).toBe(502);
  });
});
describe("private account information API", () => {
  it("rejects unverified profile reads and writes before private storage", async () => {
    m.getUser.mockResolvedValue({ data: { user: { id, email_confirmed_at: null } }, error: null });
    expect((await profile()).status).toBe(403);
    expect((await complete(request(data, "/api/me/onboarding"))).status).toBe(403);
    expect(m.from).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("saves only validated owner-derived data and permits retry after a failed atomic save", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    expect((await complete(request(data, "/api/me/onboarding"))).status).toBe(400);
    const response = await complete(request(data, "/api/me/onboarding"));
    expect(await response.json()).toEqual({ ok: true, next: "/dashboard" });
    expect(m.rpc).toHaveBeenCalledWith("complete_account_onboarding", { payload: data });
    expect(
      (await complete(request({ ...data, user_id: "other" }, "/api/me/onboarding"))).status,
    ).toBe(400);
    expect(
      (
        await complete(
          request(
            { ...data, ethnicity: "self-description", ethnicityConsent: false },
            "/api/me/onboarding",
          ),
        )
      ).status,
    ).toBe(400);
  });
  it("reads private information only for the verified owner with no caching", async () => {
    m.maybeSingle
      .mockResolvedValueOnce({
        data: {
          full_name: data.fullName,
          age: 25,
          contact_number: null,
          ethnicity: null,
          ethnicity_consent: false,
          completed_at: "2026-10-24T00:00:00Z",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: data.preferences, error: null });
    const response = await profile();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).profile).toMatchObject({
      fullName: data.fullName,
      age: 25,
      ethnicity: null,
      completedAt: "2026-10-24T00:00:00Z",
    });
    expect(m.eq).toHaveBeenNthCalledWith(1, "user_id", id);
    expect(m.eq).toHaveBeenNthCalledWith(2, "user_id", id);
  });
});
