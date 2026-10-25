import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), fetch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: m.config }));
import { getAuthProviderSettings } from "../src/features/auth/settings";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", m.fetch);
  m.config.mockReturnValue({ url: "http://127.0.0.1:55321", key: "public-test-key" });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("public provider readiness discovery", () => {
  it("discovers actual confirmation and Google flags without service credentials or caching", async () => {
    m.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ mailer_autoconfirm: false, external: { google: false, email: true } }),
      ),
    );
    expect(await getAuthProviderSettings()).toEqual({ emailConfirmation: true, google: false });
    expect(m.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:55321/auth/v1/settings",
      expect.objectContaining({
        headers: { apikey: "public-test-key" },
        cache: "no-store",
        redirect: "error",
      }),
    );
  });
  it("does not invent enabled verification or Google when settings are invalid/unavailable", async () => {
    m.fetch.mockResolvedValueOnce(new Response("provider details", { status: 503 }));
    expect(await getAuthProviderSettings()).toBeNull();
    m.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ mailer_autoconfirm: false, external: { google: "yes" } })),
    );
    expect(await getAuthProviderSettings()).toBeNull();
    m.fetch.mockRejectedValueOnce(new Error("private diagnostics"));
    expect(await getAuthProviderSettings()).toBeNull();
  });
  it("identifies automatic confirmation as unsafe for code-first signup", async () => {
    m.fetch.mockResolvedValue(
      new Response(JSON.stringify({ mailer_autoconfirm: true, external: { google: true } })),
    );
    expect(await getAuthProviderSettings()).toEqual({ emailConfirmation: false, google: true });
  });
  it("bounds provider response bodies and avoids requests when unconfigured", async () => {
    m.fetch.mockResolvedValue(new Response(" ".repeat(33000)));
    expect(await getAuthProviderSettings()).toBeNull();
    m.fetch.mockClear();
    m.config.mockReturnValue(null);
    expect(await getAuthProviderSettings()).toBeNull();
    expect(m.fetch).not.toHaveBeenCalled();
  });
});
