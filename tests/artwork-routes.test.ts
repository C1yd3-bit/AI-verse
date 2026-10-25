import sharp from "sharp";
import { crc32 } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  client: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  admin: vi.fn(),
  save: vi.fn(),
  publicClient: vi.fn(),
  publicRpc: vi.fn(),
  config: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: m.admin }));
vi.mock("@supabase/supabase-js", () => ({ createClient: m.publicClient }));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: m.config }));
import { GET, POST } from "../src/app/api/studio/versions/[versionId]/artwork/route";
import { GET as publicGET } from "../src/app/api/artwork/[versionId]/route";
import { MAX_ARTWORK_INPUT_BYTES } from "../src/features/media/artwork-schema";

const accountId = "a4000000-0000-4000-8000-000000000001";
const versionId = "a4000000-0000-4000-8000-000000000002";
const user = { id: accountId, email_confirmed_at: "2026-10-25" };
const context = (id = versionId) => ({ params: Promise.resolve({ versionId: id }) });
function request(
  body?: Uint8Array,
  mime = "image/png",
  account: string | null = accountId,
  origin = "http://localhost:3000",
) {
  return new Request("http://localhost:3000/api/studio/versions/" + versionId + "/artwork", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(account ? { "X-AIVerse-Account": account } : {}),
      ...(body === undefined ? {} : { origin, "content-type": mime }),
    },
    ...(body === undefined ? {} : { body: Buffer.from(body) }),
  });
}
const photo = (format: "png" | "jpeg" | "webp" = "png") =>
  sharp({ create: { width: 1600, height: 900, channels: 3, background: "purple" } })
    .withMetadata({ orientation: 6 })
    [format]()
    .toBuffer();
beforeEach(() => {
  vi.resetAllMocks();
  m.client.mockResolvedValue({ auth: { getUser: m.getUser }, rpc: m.rpc });
  m.getUser.mockResolvedValue({ data: { user }, error: null });
  m.rpc.mockImplementation((name: string) =>
    Promise.resolve({ data: name === "can_edit_version_artwork" ? true : null, error: null }),
  );
  m.admin.mockReturnValue({ rpc: m.save });
  m.save.mockResolvedValue({ data: null, error: null });
  m.config.mockReturnValue({ url: "http://localhost:55321", key: "public-key" });
  m.publicClient.mockReturnValue({ rpc: m.publicRpc });
  m.publicRpc.mockResolvedValue({ data: null, error: null });
});
describe("normalized per-revision artwork ingress", () => {
  it("reads private nullable artwork with identity and no-store, validates returned envelopes", async () => {
    const response = await GET(request(), context());
    expect(await response.json()).toEqual({ accountId, versionId, image: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    for (const data of ["https://secret.test/image", "data:image/webp;base64,YWJj", {}]) {
      m.rpc.mockResolvedValueOnce({ data, error: null });
      expect((await GET(request(), context())).status).toBe(502);
    }
  });
  it("blocks anonymous, unverified, stale, invalid revision and foreign-origin writes before decoder/admin", async () => {
    m.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await POST(request(new Uint8Array([1])), context())).status).toBe(401);
    m.getUser.mockResolvedValueOnce({
      data: { user: { ...user, email_confirmed_at: null } },
      error: null,
    });
    expect((await POST(request(new Uint8Array([1])), context())).status).toBe(403);
    for (const account of [null, "other"])
      expect(
        (await POST(request(new Uint8Array([1]), "image/png", account), context())).status,
      ).toBe(409);
    expect((await POST(request(new Uint8Array([1])), context("invalid"))).status).toBe(404);
    expect(
      (
        await POST(
          request(new Uint8Array([1]), "image/png", accountId, "https://foreign.test"),
          context(),
        )
      ).status,
    ).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });
  it("denies noncreator/nonowner/stale-state preflight and absent storage before reading image bytes", async () => {
    m.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await POST(request(new Uint8Array([1])), context())).status).toBe(403);
    m.admin.mockReturnValueOnce(null);
    expect((await POST(request(new Uint8Array([1])), context())).status).toBe(503);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("normalizes JPEG PNG WebP preserving oriented aspect, caps dimensions and strips metadata", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const response = await POST(request(await photo(format), `image/${format}`), context());
      expect(response.status).toBe(200);
      const result = await response.json();
      const bytes = Buffer.from(result.image.split(",")[1], "base64");
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({ width: 720, height: 1280, format: "webp" });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(bytes.length).toBeLessThanOrEqual(262144);
      expect(m.save).toHaveBeenLastCalledWith("set_version_artwork", {
        target_account: accountId,
        version_id: versionId,
        image_data: result.image,
      });
    }
  });
  it("rejects SVG GIF MIME spoof corrupt empty and oversize bytes without saving", async () => {
    const bytes = await photo();
    for (const mime of ["image/svg+xml", "image/gif", "text/html"])
      expect((await POST(request(bytes, mime), context())).status).toBe(415);
    for (const invalid of [Buffer.from("<svg/>"), Buffer.alloc(0), bytes.subarray(0, 32)])
      expect((await POST(request(invalid), context())).status).toBe(400);
    expect((await POST(request(bytes, "image/jpeg"), context())).status).toBe(400);
    expect(
      (await POST(request(new Uint8Array(MAX_ARTWORK_INPUT_BYTES + 1)), context())).status,
    ).toBe(413);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("bounds dishonest chunked Content-Length and cancels oversized streams", async () => {
    const canceled = vi.fn();
    const req = new Request("http://localhost:3000/api/studio/versions/x/artwork", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "image/png",
        "content-length": "1",
        "X-AIVerse-Account": accountId,
      },
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel: canceled,
      }),
      duplex: "half",
    } as RequestInit);
    expect((await POST(req, context())).status).toBe(413);
    expect(canceled).toHaveBeenCalled();
  });
  it("cancels a stalled body at the total ten-second ingress deadline", async () => {
    vi.useFakeTimers();
    try {
      const canceled = vi.fn();
      const req = new Request("http://localhost:3000/api/studio/versions/x/artwork", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "image/png",
          "X-AIVerse-Account": accountId,
        },
        body: new ReadableStream({
          start() {
            /* intentionally stalled body */
          },
          cancel: canceled,
        }),
        duplex: "half",
      } as RequestInit);
      const pending = POST(req, context());
      await vi.advanceTimersByTimeAsync(10_001);
      expect((await pending).status).toBe(408);
      expect(canceled).toHaveBeenCalled();
      expect(m.save).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects decoded overlarge images and PNG/WebP animation", async () => {
    const large = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    expect((await POST(request(large), context())).status).toBe(400);
    const animated = await sharp(
      Buffer.from(
        Array.from({ length: 8 }, (_, index) => (index < 4 ? [255, 0, 0] : [0, 0, 255])).flat(),
      ),
      { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } },
    )
      .webp({ loop: 0 })
      .toBuffer();
    expect((await POST(request(animated, "image/webp"), context())).status).toBe(400);
    const png = await photo();
    const chunk = Buffer.alloc(20);
    chunk.writeUInt32BE(8);
    chunk.write("acTL", 4);
    chunk.writeUInt32BE(2, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), 16);
    expect(
      (
        await POST(
          request(Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)])),
          context(),
        )
      ).status,
    ).toBe(400);
  });
  it("SQL rejection after normalization remains authoritative and redacts privileged errors", async () => {
    m.save.mockResolvedValueOnce({ error: { code: "42501", message: "secret provider value" } });
    const response = await POST(request(await photo()), context());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("secret");
  });
});
describe("anonymous public artwork boundary", () => {
  it("uses only anonymous RPC, never private access, returns uncached validated WebP", async () => {
    const bytes = await sharp({
      create: { width: 32, height: 18, channels: 3, background: "blue" },
    })
      .webp()
      .toBuffer();
    m.publicRpc.mockResolvedValueOnce({
      data: "data:image/webp;base64," + bytes.toString("base64"),
      error: null,
    });
    const response = await publicGET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(m.publicRpc).toHaveBeenCalledExactlyOnceWith("get_public_version_artwork", {
      version_id: versionId,
    });
    expect(m.getUser).not.toHaveBeenCalled();
  });
  it("fails closed for unapproved missing or corrupt projections and invalid IDs", async () => {
    expect((await publicGET(request(), context())).status).toBe(404);
    expect((await publicGET(request(), context("bad"))).status).toBe(404);
    m.publicRpc.mockResolvedValueOnce({ data: "https://secret.test", error: null });
    expect((await publicGET(request(), context())).status).toBe(502);
    m.publicRpc.mockResolvedValueOnce({ data: null, error: { message: "secret" } });
    const response = await publicGET(request(), context());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret");
    m.config.mockReturnValueOnce(null);
    expect((await publicGET(request(), context())).status).toBe(503);
  });
});
