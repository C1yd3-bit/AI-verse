import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  server: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => null }));
import { GET as studio } from "../src/app/api/studio/route";
import { GET as applications, POST as apply } from "../src/app/api/creator/applications/route";
import { POST as draft } from "../src/app/api/studio/versions/route";
import { POST as upload } from "../src/app/api/studio/uploads/route";
const accountId = "98000000-0000-4000-8000-000000000001";
const other = "98000000-0000-4000-8000-000000000002";
const versionId = "98000000-0000-4000-8000-000000000003";
const metadata = {
  title: "Original film",
  description: "A fixture test film.",
  format: "reel",
  genres: ["romance"],
  regions: ["korean"],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "All original materials for this private local fixture.",
};
const application = {
  display_name: "Creator",
  handle: "test-creator",
  bio: "Original short films.",
  portfolio_url: "https://example.test/portfolio",
  rights_attested: true,
};
const endpoints = [
  { handler: studio, method: "GET", path: "/api/studio", body: undefined },
  { handler: applications, method: "GET", path: "/api/creator/applications", body: undefined },
  { handler: apply, method: "POST", path: "/api/creator/applications", body: application },
  {
    handler: draft,
    method: "POST",
    path: "/api/studio/versions",
    body: { videoId: null, metadata },
  },
  {
    handler: upload,
    method: "POST",
    path: "/api/studio/uploads",
    body: { versionId, idempotencyKey: "stable-test-request-key", fileSize: 1024 },
  },
];
function request(
  endpoint: (typeof endpoints)[number],
  expected: string | null = accountId,
  origin = "http://localhost:3000",
  body: unknown = endpoint.body,
) {
  return new Request(`http://localhost:3000${endpoint.path}`, {
    method: endpoint.method,
    headers: {
      ...(endpoint.method === "POST" ? { origin, "content-type": "application/json" } : {}),
      ...(expected === null ? {} : { "X-AIVerse-Account": expected }),
    },
    ...(endpoint.method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: accountId, email_confirmed_at: "2026-10-25T00:00:00Z" } },
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "order", "limit"]) chain[name] = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => void) =>
      resolve({ data: table === "user_roles" ? [{ role: "creator" }] : [], error: null });
    return chain;
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "submit_creator_application"
        ? versionId
        : { video_id: other, version_id: versionId },
    error: null,
  }));
  mocks.server.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  });
});
afterEach(() => vi.restoreAllMocks());
async function error(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(Object.keys(await response.json())).toEqual(["error"]);
}
describe("Studio verified-account comparison boundaries", () => {
  it.each(endpoints)(
    "rejects stale $method $path before private lookup or mutation",
    async (endpoint) => {
      await error(await endpoint.handler(request(endpoint, other)), 409);
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(endpoints)("requires a verified session for $method $path", async (endpoint) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await error(await endpoint.handler(request(endpoint)), 401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(endpoints.filter((endpoint) => endpoint.method === "POST"))(
    "rejects cross-origin $path before authentication/provider work",
    async (endpoint) => {
      await error(await endpoint.handler(request(endpoint, accountId, "https://other.test")), 403);
      expect(mocks.server).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(endpoints.filter((endpoint) => endpoint.method === "POST"))(
    "rejects extra fields at $path",
    async (endpoint) => {
      await error(
        await endpoint.handler(
          request(endpoint, accountId, undefined, { ...endpoint.body, owner_id: other }),
        ),
        400,
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("preserves absent comparison-header clients while owner-scoping private reads", async () => {
    expect((await studio(request(endpoints[0], null))).status).toBe(200);
    expect((await applications(request(endpoints[1], null))).status).toBe(200);
    const tables = mocks.from.mock.calls.map(([table]) => table);
    expect(tables).toEqual(["user_roles", "videos", "creator_applications"]);
    expect(mocks.from.mock.results[0].value.eq).toHaveBeenCalledWith("user_id", accountId);
    expect(mocks.from.mock.results[1].value.eq).toHaveBeenCalledWith("owner_id", accountId);
    expect(mocks.from.mock.results[2].value.eq).toHaveBeenCalledWith("user_id", accountId);
  });
  it("delegates draft/application ownership and creator privileges to the established user RPCs", async () => {
    expect((await apply(request(endpoints[2]))).status).toBe(201);
    expect((await draft(request(endpoints[3]))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_creator_application", { application });
    expect(mocks.rpc).toHaveBeenCalledWith("create_video_version", { video_id: null, metadata });
  });
});
