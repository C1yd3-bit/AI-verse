import sharp from "sharp";
import { crc32 } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: m.client }));
import { GET, POST } from "../src/app/api/me/avatar/route";
import { MAX_AVATAR_INPUT_BYTES } from "../src/features/profile/avatar";

const user = { id: "93000000-0000-4000-8000-000000000001", email_confirmed_at: "2026-10-24" };
function request(
  body?: Uint8Array,
  mime = "image/png",
  account: string | null = user.id,
  origin = "http://localhost:3000",
) {
  return new Request("http://localhost:3000/api/me/avatar", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { origin, "content-type": mime }),
      ...(account ? { "x-aiverse-account": account } : {}),
    },
    ...(body === undefined ? {} : { body: Buffer.from(body) }),
  });
}
async function photo(format: "png" | "jpeg" | "webp" = "png") {
  return sharp({ create: { width: 100, height: 180, channels: 3, background: "#6741a5" } })
    [format]()
    .toBuffer();
}
function pngChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.client.mockResolvedValue({ auth: { getUser: m.getUser }, rpc: m.rpc });
  m.getUser.mockResolvedValue({ data: { user }, error: null });
  m.rpc.mockResolvedValue({ data: null, error: null });
});
describe("private photo routes", () => {
  it("reads a nullable private photo without requiring a GET Origin and does not cache", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accountId: user.id, image: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("get_my_avatar");
    const image = `data:image/webp;base64,${(await photo("webp")).toString("base64")}`;
    m.rpc.mockResolvedValueOnce({ data: image, error: null });
    expect((await (await GET(request())).json()).image).toBe(image);
  });
  it("blocks anonymous, unverified and stale-session reads or writes before image processing or RPC", async () => {
    m.client.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(503);
    m.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await POST(request(new Uint8Array([1])))).status).toBe(401);
    m.getUser.mockResolvedValue({
      data: { user: { ...user, email_confirmed_at: null } },
      error: null,
    });
    expect((await GET(request())).status).toBe(403);
    expect((await POST(request(new Uint8Array([1])))).status).toBe(403);
    m.getUser.mockResolvedValue({ data: { user }, error: null });
    for (const account of [null, "other-user"]) {
      expect((await GET(request(undefined, "image/png", account))).status).toBe(409);
      expect((await POST(request(new Uint8Array([1]), "image/png", account))).status).toBe(409);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("blocks foreign mutation origins and MIME/decoded-format spoofing", async () => {
    const png = await photo();
    expect((await POST(request(png, "image/png", user.id, "https://foreign.example"))).status).toBe(
      403,
    );
    expect((await POST(request(png, "image/jpeg"))).status).toBe(400);
    for (const mime of ["image/svg+xml", "image/gif", "text/html", "application/octet-stream"])
      expect((await POST(request(png, mime))).status).toBe(415);
    expect(
      (await POST(request(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))).status,
    ).toBe(400);
    expect((await POST(request(png.subarray(0, 32)))).status).toBe(400);
    expect((await POST(request(new Uint8Array()))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("bounds chunked uploads independently of Content-Length and cancels oversized streams", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        canceled = true;
      },
    });
    const oversized = new Request("http://localhost:3000/api/me/avatar", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "image/png",
        "content-length": "1",
        "x-aiverse-account": user.id,
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await POST(oversized)).status).toBe(413);
    expect(canceled).toBe(true);
    expect((await POST(request(new Uint8Array(MAX_AVATAR_INPUT_BYTES + 1)))).status).toBe(413);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rejects large decoded dimensions and animated WebP", async () => {
    const large = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    expect((await POST(request(large))).status).toBe(400);
    const frames = Buffer.from([
      ...Array.from({ length: 4 }, () => [255, 0, 0]).flat(),
      ...Array.from({ length: 4 }, () => [0, 0, 255]).flat(),
    ]);
    const animated = await sharp(frames, {
      raw: { width: 2, height: 4, channels: 3, pageHeight: 2 },
    })
      .webp({ loop: 0 })
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect((await POST(request(animated, "image/webp"))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rejects PNG animation control even when the decoder exposes only its static default frame", async () => {
    const png = await photo();
    const animationControl = Buffer.alloc(8);
    animationControl.writeUInt32BE(2);
    const animated = Buffer.concat([
      png.subarray(0, 33),
      pngChunk("acTL", animationControl),
      png.subarray(33),
    ]);
    // This ancillary chunk can be silently ignored by the static PNG decoder.
    expect((await sharp(animated).metadata()).format).toBe("png");
    expect((await POST(request(animated))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("decodes each supported image, orients/crops a metadata-free 256px WebP and saves only normalized bytes", async () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const original = await sharp({
        create: { width: 100, height: 180, channels: 3, background: "blue" },
      })
        .withMetadata({ orientation: 6 })
        [format]()
        .toBuffer();
      const response = await POST(request(original, `image/${format}`));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.accountId).toBe(user.id);
      expect(result.image).toMatch(/^data:image\/webp;base64,/);
      const bytes = Buffer.from(result.image.split(",")[1], "base64");
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({ format: "webp", width: 256, height: 256 });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(bytes.length).toBeLessThanOrEqual(65536);
      expect(bytes.equals(original)).toBe(false);
      expect(m.rpc).toHaveBeenLastCalledWith("set_my_avatar", { photo_data: result.image });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
  it("fails closed on unsafe database projection and redacts backend errors", async () => {
    for (const data of [
      { image: "secret" },
      "https://foreign.example/x.jpg",
      "data:image/webp;base64,YWJj",
      "data:image/svg+xml;base64,PHN2Zz4=",
    ]) {
      m.rpc.mockResolvedValueOnce({ data, error: null });
      const response = await GET(request());
      expect(response.status).toBe(502);
      expect(await response.text()).not.toMatch(/secret|foreign|PHN2/);
    }
    m.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "secret database detail" },
    });
    const response = await POST(request(await photo()));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("secret");
  });
});
