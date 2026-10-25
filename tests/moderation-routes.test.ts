import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  server: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.server }));
import { GET } from "../src/app/api/moderation/route";
import { POST } from "../src/app/api/moderation/decisions/route";

const accountId = "95000000-0000-4000-8000-000000000001";
const otherAccount = "95000000-0000-4000-8000-000000000099";
const versionId = "95000000-0000-4000-8000-000000000002";
let roles: string[];
let queryError: { code: string } | null;
function request(
  method: "GET" | "POST",
  expected: string | null = accountId,
  origin = "http://localhost:3000",
  body: unknown = {
    kind: "version",
    id: versionId,
    approve: false,
    reason: "Needs another review.",
  },
) {
  return new Request(
    `http://localhost:3000/api/moderation${method === "POST" ? "/decisions" : ""}`,
    {
      method,
      headers: {
        ...(method === "POST" ? { "content-type": "application/json", origin } : {}),
        ...(expected !== null ? { "X-AIVerse-Account": expected } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  roles = ["moderator"];
  queryError = null;
  mocks.getUser.mockResolvedValue({
    data: { user: { id: accountId, email_confirmed_at: "2026-10-25T00:00:00Z" } },
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) chain[method] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => void) =>
      resolve({
        data: table === "user_roles" ? roles.map((role) => ({ role })) : [],
        error: queryError,
      });
    return chain;
  });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.server.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  });
});
afterEach(() => vi.restoreAllMocks());

async function responseError(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(Object.keys(await response.json())).toEqual(["error"]);
}
describe("moderation route account comparison and role boundaries", () => {
  it.each(["GET", "POST"] as const)(
    "rejects a stale %s account before any queue lookup or decision",
    async (method) => {
      const response =
        method === "GET"
          ? await GET(request(method, otherAccount))
          : await POST(request(method, otherAccount));
      await responseError(response, 409);
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["GET", "POST"] as const)(
    "rejects an absent session before %s account comparison",
    async (method) => {
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
      await responseError(
        method === "GET" ? await GET(request(method)) : await POST(request(method)),
        401,
      );
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("queries film revisions for a moderator without exposing or requesting creator applications", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ roles: ["moderator"], versions: [], applications: [] });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["user_roles", "video_versions"]);
  });
  it("queries creator applications only when the verified account has an admin role", async () => {
    roles = ["admin"];
    expect((await GET(request("GET"))).status).toBe(200);
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
      "user_roles",
      "video_versions",
      "creator_applications",
    ]);
  });
  it("denies an ordinary account before reading any private submissions", async () => {
    roles = ["viewer"];
    await responseError(await GET(request("GET")), 403);
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["user_roles"]);
  });
  it("preserves legacy clients without a comparison header while always using the verified session", async () => {
    expect((await GET(request("GET", null))).status).toBe(200);
    expect((await POST(request("POST", null))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("review_video_version", {
      version_id: versionId,
      approve: false,
      reason: "Needs another review.",
    });
  });
  it("delegates exact-version decisions through the existing user-scoped RPC", async () => {
    expect((await POST(request("POST"))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("review_video_version", {
      version_id: versionId,
      approve: false,
      reason: "Needs another review.",
    });
  });
  it("keeps denied admin-role mutations denied and sanitizes database details", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "42501", message: "private detail" } });
    const response = await POST(
      request("POST", accountId, undefined, {
        kind: "application",
        id: versionId,
        approve: true,
        reason: "Try administrator-only grant.",
      }),
    );
    const body = await response.clone().text();
    expect(body).not.toContain("private detail");
    await responseError(response, 403);
  });
  it("rejects malformed decision input without invoking the database", async () => {
    await responseError(
      await POST(
        request("POST", accountId, undefined, {
          kind: "version",
          id: versionId,
          approve: true,
          reason: "no",
        }),
      ),
      400,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin decisions before looking up the session", async () => {
    await responseError(await POST(request("POST", accountId, "https://other.test")), 403);
    expect(mocks.server).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("sanitizes a queue database failure with a retryable response", async () => {
    queryError = { code: "XX000" };
    await responseError(await GET(request("GET")), 409);
  });
});
