import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: m.client }));
import { POST } from "../src/app/api/me/library/route";

const accountId = "93000000-0000-4000-8000-000000000001";
const body = { action: "save_fusion", id: null, name: "My mix", query: {} };
function request(expected?: string, extra = {}) {
  return new Request("http://localhost:3000/api/me/library", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...(expected === undefined ? {} : { "x-aiverse-account": expected }),
    },
    body: JSON.stringify({ ...body, ...extra }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  m.rpc.mockResolvedValue({ data: null, error: null });
  m.client.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: accountId } }, error: null }) },
    rpc: m.rpc,
  });
});
describe("saved-mix comparison identity", () => {
  it("denies a changed or empty comparison identity before a write", async () => {
    for (const expected of ["93000000-0000-4000-8000-000000000002", ""]) {
      expect((await POST(request(expected))).status).toBe(409);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("retains legacy callers and never uses the matching header as an owner selector", async () => {
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request(accountId))).status).toBe(200);
    expect(m.rpc).toHaveBeenLastCalledWith("save_fusion", {
      filter_id: null,
      name: "My mix",
      query: {
        keywords: [],
        regions: [],
        genres: [],
        formats: [],
        languages: [],
        hashtags: [],
      },
    });
  });
  it("rejects forged owner input even with a matching comparison header", async () => {
    expect((await POST(request(accountId, { userId: accountId }))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
