import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  createStreamProvider,
  getStreamConfig,
  StreamProviderError,
  type StreamConfig,
} from "../src/features/media/stream";
import {
  MAX_WEBHOOK_BYTES,
  readAndVerifyStreamWebhook,
  verifyStreamWebhook,
} from "../src/features/media/webhook";

const account = "a".repeat(32);
const assetId = "b".repeat(32);
const otherId = "c".repeat(32);
const secret = "webhook-test-secret-with-enough-entropy";
const config: StreamConfig = { accountId: account, apiToken: "test-provider-token-keep-private" };
const time = Date.UTC(2026, 9, 24);
const now = () => time;
const validAsset = {
  uid: assetId,
  creator: "creator_123",
  meta: { operationKey: "operation_123", filename: "private-media.mp4" },
  readyToStream: true,
  requireSignedURLs: true,
  duration: 125.7,
  status: { state: "ready", errorReasonText: "private provider detail" },
  preview: "https://private-preview.example/secret",
};
function success(result: unknown) {
  return new Response(JSON.stringify({ success: true, result }));
}
function setup(responses: Response[] = []) {
  const fetcher = vi.fn<typeof fetch>();
  responses.forEach((response) => fetcher.mockResolvedValueOnce(response));
  return { fetcher, provider: createStreamProvider(config, { fetch: fetcher, now }) };
}
function jwt(claims: Record<string, unknown>) {
  return `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(
    JSON.stringify({ sub: assetId, ...claims }),
  ).toString("base64url")}.signature`;
}
function signature(body: Uint8Array, timestamp = time / 1000) {
  return `time=${timestamp},sig1=${createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest("hex")}`;
}
const body = Buffer.from(JSON.stringify(validAsset) + "\n");

afterEach(() => vi.useRealTimers());

describe("server-only Stream provider", () => {
  it("treats absent or malformed credentials as unconfigured", () => {
    expect(getStreamConfig({})).toBeNull();
    expect(
      getStreamConfig({ CLOUDFLARE_ACCOUNT_ID: "../elsewhere", CLOUDFLARE_STREAM_API_TOKEN: "x" }),
    ).toBeNull();
    expect(
      getStreamConfig({
        CLOUDFLARE_ACCOUNT_ID: account,
        CLOUDFLARE_STREAM_API_TOKEN: config.apiToken,
      }),
    ).toEqual(config);
    expect(() => createStreamProvider({ ...config, accountId: "https://evil.example" })).toThrow(
      "unconfigured",
    );
  });

  it("requires signed private uploads, bounded duration, expiry and recovery metadata", async () => {
    const { fetcher, provider } = setup([
      success({ uid: assetId, uploadURL: `https://upload.videodelivery.net/${assetId}` }),
    ]);
    const expiresAt = new Date(time + 15 * 60 * 1000);
    expect(
      await provider.createDirectUpload({
        creatorId: "creator_123",
        operationKey: "operation_123",
        maxDurationSeconds: 180,
        expiresAt,
      }),
    ).toEqual({
      assetId,
      uploadUrl: `https://upload.videodelivery.net/${assetId}`,
      expiresAt: expiresAt.toISOString(),
      protocol: "multipart",
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${account}/stream/direct_upload`,
    );
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(JSON.parse(init?.body as string)).toEqual({
      creator: "creator_123",
      meta: { operationKey: "operation_123" },
      maxDurationSeconds: 180,
      expiry: expiresAt.toISOString(),
      requireSignedURLs: true,
    });
  });

  it("rejects expiry/duration bypasses without making requests", async () => {
    const { provider, fetcher } = setup();
    for (const invalid of [
      { maxDurationSeconds: -1 },
      { maxDurationSeconds: 1201 },
      { expiresAt: new Date(time - 1) },
      { expiresAt: new Date(time + 3600001) },
      { operationKey: "../../forged" },
    ]) {
      await expect(
        provider.createDirectUpload({
          creatorId: "creator_123",
          operationKey: "operation_123",
          maxDurationSeconds: 180,
          expiresAt: new Date(time + 900000),
          ...invalid,
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(provider.getAsset("../../token")).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("provisions a private opaque TUS endpoint for the full TARU file with a separately authenticated identity", async () => {
    const uploadURL = "https://upload.videodelivery.net/tus/opaque-credential_123";
    const { fetcher, provider } = setup([
      new Response(null, {
        status: 201,
        headers: {
          location: uploadURL,
          "stream-media-id": assetId,
        },
      }),
    ]);
    const expiresAt = new Date(time + 900000);
    expect(
      await provider.createDirectUpload({
        creatorId: "creator_123",
        operationKey: "operation_123",
        maxDurationSeconds: 1063,
        fileSize: 329742172,
        expiresAt,
      }),
    ).toEqual({
      assetId,
      uploadUrl: uploadURL,
      expiresAt: expiresAt.toISOString(),
      protocol: "tus",
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${account}/stream?direct_user=true`,
    );
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      body: undefined,
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("Tus-Resumable")).toBe("1.0.0");
    expect(headers.get("Upload-Length")).toBe("329742172");
    expect(headers.get("Upload-Creator")).toBe("creator_123");
    const fields = Object.fromEntries(
      headers
        .get("Upload-Metadata")!
        .split(",")
        .map((field) => {
          const [key, value] = field.split(" ");
          return [key, value ? Buffer.from(value, "base64").toString() : ""];
        }),
    );
    expect(fields).toEqual({
      maxDurationSeconds: "1063",
      requiresignedurls: "",
      expiry: expiresAt.toISOString(),
      operationKey: "operation_123",
    });
  });

  it("keeps exactly200MB multipart and rejects invalid file sizes before provider work", async () => {
    const result = setup([
      success({ uid: assetId, uploadURL: `https://upload.videodelivery.net/${assetId}` }),
    ]);
    const base = {
      creatorId: "creator_123",
      operationKey: "operation_123",
      maxDurationSeconds: 1200,
      expiresAt: new Date(time + 900000),
    };
    expect(
      (await result.provider.createDirectUpload({ ...base, fileSize: 200000000 })).protocol,
    ).toBe("multipart");
    const denied = setup();
    for (const size of [0, -1, 500000001, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      await expect(
        denied.provider.createDirectUpload({ ...base, fileSize: size }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    expect(denied.fetcher).not.toHaveBeenCalled();
  });

  it("rejects unsafe, noncanonical or incomplete TUS responses without returning bearer data", async () => {
    const valid = "https://upload.videodelivery.net/tus/opaque_123";
    const cases: { status?: number; location?: string; id?: string }[] = [
      { location: "https://evil.example/tus/opaque" },
      { location: "http://upload.videodelivery.net/tus/opaque" },
      { location: valid + "?secret=token" },
      { location: valid + "#fragment" },
      { location: "https://user:password@upload.videodelivery.net/tus/opaque" },
      { location: "https://upload.videodelivery.net:443/tus/opaque" },
      { location: "https://upload.videodelivery.net/a/../opaque" },
      { location: "https://upload.videodelivery.net/tus/%2e" },
      { location: valid, id: "not-an-id" },
      { location: valid, id: "" },
      { location: "" },
      { location: valid, status: 200 },
    ];
    for (const item of cases) {
      const { provider } = setup([
        new Response(null, {
          status: item.status ?? 201,
          headers: { location: item.location ?? valid, "stream-media-id": item.id ?? assetId },
        }),
      ]);
      await expect(
        provider.createDirectUpload({
          creatorId: "creator_123",
          operationKey: "operation_123",
          maxDurationSeconds: 1200,
          fileSize: 329742172,
          expiresAt: new Date(time + 900000),
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("bounds large-film playback to the explicit SQL duration-derived expiry", async () => {
    const exp = time / 1000 + 990;
    const { provider, fetcher } = setup([
      success({ ...validAsset, duration: 930 }),
      success({ token: jwt({ exp }) }),
    ]);
    expect((await provider.createPlaybackToken(assetId, 990, exp)).expiresAt).toBe(exp);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      exp,
      downloadable: false,
    });
    await expect(provider.createPlaybackToken(assetId, 1261)).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("rejects provider upload redirects and arbitrary grant hosts", async () => {
    for (const uploadURL of [
      `https://evil.example/${assetId}`,
      `http://upload.videodelivery.net/${assetId}`,
      `https://upload.videodelivery.net.evil.example/${assetId}`,
      `https://upload.videodelivery.net/${otherId}`,
      `https://user:password@upload.videodelivery.net/${assetId}`,
    ]) {
      const { provider } = setup([success({ uid: assetId, uploadURL })]);
      await expect(
        provider.createDirectUpload({
          creatorId: "creator_123",
          operationKey: "operation_123",
          maxDurationSeconds: 180,
          expiresAt: new Date(time + 900000),
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("returns only validated provider evidence, excludes URLs and arbitrary private metadata", async () => {
    const { provider } = setup([success(validAsset)]);
    expect(await provider.getAsset(assetId)).toEqual({
      assetId,
      creatorId: "creator_123",
      operationKey: "operation_123",
      state: "ready",
      readyToStream: true,
      requireSignedURLs: true,
      durationSeconds: 125.7,
    });
    const wrong = setup([success({ ...validAsset, uid: otherId })]);
    await expect(wrong.provider.getAsset(assetId)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("requests and verifies short playback expiry with no downloads", async () => {
    const exp = time / 1000 + 300;
    const token = jwt({ exp });
    const { provider, fetcher } = setup([success(validAsset), success({ token })]);
    expect(await provider.createPlaybackToken(assetId)).toEqual({ token, expiresAt: exp });
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({
      exp,
      downloadable: false,
    });
    await expect(provider.createPlaybackToken(assetId, 1261)).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("denies token grants for public, processing or failed assets", async () => {
    for (const change of [
      { requireSignedURLs: false },
      { readyToStream: false },
      { status: { state: "inprogress" } },
      { status: { state: "error" } },
      { duration: 0 },
    ]) {
      const { provider, fetcher } = setup([success({ ...validAsset, ...change })]);
      await expect(provider.createPlaybackToken(assetId)).rejects.toMatchObject({
        code: "unsafe_asset",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("fails closed if the provider returns excessive/expired/wrong-asset/download tokens", async () => {
    for (const claims of [
      { exp: time / 1000 + 3600 },
      { exp: time / 1000 },
      { exp: time / 1000 + 60, sub: otherId },
      { exp: time / 1000 + 60, downloadable: true },
    ]) {
      const { provider } = setup([success(validAsset), success({ token: jwt(claims) })]);
      await expect(provider.createPlaybackToken(assetId)).rejects.toMatchObject({
        code: "invalid_response",
      });
    }
  });

  it("treats missing deletes as success but does not suppress other errors", async () => {
    const { provider } = setup([
      new Response("", { status: 404 }),
      success(null),
      new Response("private-message", { status: 403 }),
    ]);
    await provider.deleteAsset(assetId);
    await provider.deleteAsset(assetId);
    await expect(provider.deleteAsset(assetId)).rejects.toMatchObject({
      code: "provider_failure",
      status: 403,
    });
  });

  it("keeps the database absolute expiry when provider lookup advances the clock", async () => {
    let clock = time;
    const deadline = time / 1000 + 60;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        clock += 25000;
        return success(validAsset);
      })
      .mockImplementationOnce(async (_url, init) => {
        expect(JSON.parse(String(init?.body)).exp).toBe(deadline);
        return success({ token: jwt({ exp: deadline }) });
      });
    const provider = createStreamProvider(config, { fetch: fetcher, now: () => clock });
    expect((await provider.createPlaybackToken(assetId, 60, deadline)).expiresAt).toBe(deadline);
  });

  it("bounds streamed responses even when content length is absent or false", async () => {
    for (const response of [
      new Response("x".repeat(65537)),
      new Response("x", { headers: { "content-length": "65537" } }),
      new Response(JSON.stringify({ success: false, errors: [{ message: config.apiToken }] })),
      new Response("not-json"),
    ]) {
      const { provider } = setup([response]);
      await expect(provider.getAsset(assetId)).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("times out a stalled request and aborts its signal", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const provider = createStreamProvider(config, { fetch: fetcher, now, timeoutMs: 100 });
    const result = expect(provider.getAsset(assetId)).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(101);
    await result;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("times out a stalled response body and redacts provider/network errors", async () => {
    vi.useFakeTimers();
    const stalledBody = new ReadableStream<Uint8Array>({ start() {} });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stalledBody));
    const provider = createStreamProvider(config, { fetch: fetcher, now, timeoutMs: 100 });
    const result = expect(provider.getAsset(assetId)).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(101);
    await result;
    const failing = createStreamProvider(config, {
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error(config.apiToken)),
    });
    try {
      await failing.getAsset(assetId);
      expect.fail("Expected scrubbed error");
    } catch (error) {
      expect(error).toBeInstanceOf(StreamProviderError);
      expect(String(error)).not.toContain(config.apiToken);
      expect(error).not.toHaveProperty("cause");
    }
  });
});

describe("Stream webhook authentication", () => {
  it("authenticates exact raw bytes including newlines and gives durable deduplication digest", () => {
    const result = verifyStreamWebhook(body, signature(body), secret, { now });
    expect(result.asset.assetId).toBe(assetId);
    expect(result.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(result.eventId).toBe(
      verifyStreamWebhook(body, signature(body, time / 1000 - 5), secret, { now }).eventId,
    );
    expect(() =>
      verifyStreamWebhook(body.subarray(0, body.length - 1), signature(body), secret, { now }),
    ).toThrow("unauthorized");
  });

  it("rejects stale and far future replay timestamps", () => {
    for (const timestamp of [time / 1000 - 301, time / 1000 + 31]) {
      expect(() => verifyStreamWebhook(body, signature(body, timestamp), secret, { now })).toThrow(
        "unauthorized",
      );
    }
    expect(
      verifyStreamWebhook(body, signature(body, time / 1000 - 300), secret, { now }).asset.assetId,
    ).toBe(assetId);
  });

  it("rejects missing, incorrect and ambiguous signatures", () => {
    for (const header of [
      null,
      "",
      signature(body) + ",time=0",
      "time=0,sig1=short",
      signature(body).replace(/.$/, "z"),
    ]) {
      expect(() => verifyStreamWebhook(body, header, secret, { now })).toThrow("unauthorized");
    }
    expect(() =>
      verifyStreamWebhook(body, signature(body), "other-secret-is-not-valid", { now }),
    ).toThrow("unauthorized");
    expect(() => verifyStreamWebhook(body, signature(body), "", { now })).toThrow("unconfigured");
  });

  it("rejects authenticated malformed/oversize data without returning provider body details", () => {
    for (const invalid of [
      Buffer.from("not json"),
      Buffer.from('{"uid":"evil"}'),
      Buffer.from([0xff]),
    ]) {
      expect(() => verifyStreamWebhook(invalid, signature(invalid), secret, { now })).toThrow(
        "invalid_body",
      );
    }
    const oversized = Buffer.alloc(MAX_WEBHOOK_BYTES + 1);
    expect(() => verifyStreamWebhook(oversized, signature(oversized), secret, { now })).toThrow(
      "invalid_body",
    );
  });

  it("reads a bounded Request and verifies before handing evidence to a caller", async () => {
    const request = new Request("https://local.example/api/media/webhook", {
      method: "POST",
      headers: { "webhook-signature": signature(body) },
      body,
    });
    expect((await readAndVerifyStreamWebhook(request, secret, { now })).asset.assetId).toBe(
      assetId,
    );
    const headerCases: HeadersInit[] = [
      {},
      { "content-length": "1" },
      { "content-length": "999999" },
    ];
    for (const headers of headerCases) {
      await expect(
        readAndVerifyStreamWebhook(
          new Request("https://local.example", {
            method: "POST",
            headers,
            body: "x".repeat(MAX_WEBHOOK_BYTES + 1),
          }),
          secret,
          { now },
        ),
      ).rejects.toMatchObject({ code: "invalid_body" });
    }
  });
});
