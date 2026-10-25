import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), cookies: vi.fn(), create: vi.fn(), set: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: m.create }));
vi.mock("next/headers", () => ({ cookies: m.cookies }));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: m.config }));
import { createSupabaseServerClient } from "../src/lib/supabase/server";
beforeEach(() => {
  vi.resetAllMocks();
  m.config.mockReturnValue({ url: "http://127.0.0.1:55321", key: "test-public-key" });
  m.cookies.mockResolvedValue({
    getAll: () => [{ name: "test-session", value: "opaque" }],
    set: m.set,
  });
  m.create.mockReturnValue({});
});
describe("Supabase server cookie write modes", () => {
  it("permits Server Component validation/refresh without mutating read-only cookies", async () => {
    m.set.mockImplementation(() => {
      throw new Error("Read-only cookie store");
    });
    await createSupabaseServerClient({ readOnlyCookies: true });
    const adapter = m.create.mock.calls[0][2].cookies;
    expect(adapter.getAll()).toEqual([{ name: "test-session", value: "opaque" }]);
    expect(() =>
      adapter.setAll([{ name: "test-session", value: "refreshed", options: { path: "/" } }]),
    ).not.toThrow();
    expect(m.set).not.toHaveBeenCalled();
  });
  it("keeps route handlers writable and propagates failed auth cookie persistence", async () => {
    await createSupabaseServerClient();
    const adapter = m.create.mock.calls[0][2].cookies;
    adapter.setAll([{ name: "test-session", value: "refreshed", options: { path: "/" } }]);
    expect(m.set).toHaveBeenCalledExactlyOnceWith("test-session", "refreshed", { path: "/" });
    m.set.mockImplementation(() => {
      throw new Error("Cookie write failed");
    });
    expect(() => adapter.setAll([{ name: "test-session", value: "failed", options: {} }])).toThrow(
      "Cookie write failed",
    );
  });
  it("returns no authenticated adapter when configuration is absent", async () => {
    m.config.mockReturnValue(null);
    expect(await createSupabaseServerClient({ readOnlyCookies: true })).toBeNull();
    expect(m.create).not.toHaveBeenCalled();
  });
});
