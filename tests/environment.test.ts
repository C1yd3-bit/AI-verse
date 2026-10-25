import { afterEach, describe, it, expect, vi } from "vitest";
import { getSupabaseConfig } from "../src/lib/env";
afterEach(() => vi.unstubAllEnvs());
describe("unconfigured and malformed public environment", () => {
  it("treats empty env example values as unconfigured without throwing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(getSupabaseConfig()).toBeNull();
  });
  it("rejects malformed URLs and insecure nonlocal endpoints", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-example-key-long-enough");
    for (const url of ["broken", "http://example.com", "ftp://localhost"]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(getSupabaseConfig()).toBeNull();
    }
  });
  it("allows local development with http or hosted https", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-example-key-long-enough");
    for (const url of ["http://127.0.0.1:54321", "https://example.supabase.co"]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(getSupabaseConfig()?.url).toBe(url);
    }
  });
});
