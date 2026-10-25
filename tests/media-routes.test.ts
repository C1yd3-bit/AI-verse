import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  server: vi.fn(),
  admin: vi.fn(),
  config: vi.fn(),
  provider: vi.fn(),
  getUser: vi.fn(),
  userRpc: vi.fn(),
  adminRpc: vi.fn(),
  direct: vi.fn(),
  remove: vi.fn(),
  token: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/features/media/stream", () => ({
  getStreamConfig: mocks.config,
  createStreamProvider: mocks.provider,
}));
import { POST as upload } from "../src/app/api/studio/uploads/route";
import { GET as playback } from "../src/app/api/playback/[id]/route";

const now = Date.parse("2026-10-24T12:00:00Z");
const owner = "60000000-0000-4000-8000-000000000001";
const video = "60000000-0000-4000-8000-000000000002";
const version = "60000000-0000-4000-8000-000000000003";
const reservation = "60000000-0000-4000-8000-000000000004";
const replacement = "60000000-0000-4000-8000-000000000005";
const providerUid = "a".repeat(32);
const privateUploadUrl = `https://upload.videodelivery.net/${providerUid}`;
const privateToken = "header.private_payload.signature";
const absoluteDeadline = new Date(now + 60000).toISOString();
const entitlement = {
  provider_uid: providerUid,
  version_id: version,
  duration_seconds: 90,
  expires_at: absoluteDeadline,
};
const reservationResult = {
  reservation_id: reservation,
  expires_at: new Date(now + 900000).toISOString(),
  max_duration_seconds: 180,
};
const uploadGrant = {
  protocol: "multipart" as const,
  assetId: providerUid,
  uploadUrl: privateUploadUrl,
  expiresAt: reservationResult.expires_at,
};
const tokenGrant = { token: privateToken, expiresAt: Math.floor(now / 1000) + 30 };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function uploadRequest(origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/studio/uploads", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      versionId: version,
      idempotencyKey: "stable-operation-key-001",
      fileSize: 158829024,
    }),
  });
}
function playbackRequest() {
  return playback(new Request(`http://localhost:3000/api/playback/${video}`), {
    params: Promise.resolve({ id: video }),
  });
}
async function errorBody(response: Response) {
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["error"]);
  const text = JSON.stringify(body);
  for (const secret of [
    privateUploadUrl,
    providerUid,
    privateToken,
    "private_database_details",
    "private_provider_failure",
  ])
    expect(text).not.toContain(secret);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return body;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AIVERSE_ENABLE_STREAM_UPLOADS", "true");
  vi.spyOn(Date, "now").mockReturnValue(now);
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  mocks.server.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.userRpc });
  mocks.admin.mockReturnValue({ rpc: mocks.adminRpc });
  mocks.config.mockReturnValue({
    accountId: "b".repeat(32),
    apiToken: "test-only-never-used-for-network",
  });
  mocks.provider.mockReturnValue({
    createDirectUpload: mocks.direct,
    deleteAsset: mocks.remove,
    createPlaybackToken: mocks.token,
  });
  mocks.userRpc.mockResolvedValue({ data: reservationResult, error: null });
  mocks.adminRpc.mockImplementation(async (name: string) => {
    if (name === "begin_upload_grant")
      return { data: { lease: true, operation_key: reservation }, error: null };
    if (name === "bind_video_provider") return { data: { usable: true }, error: null };
    if (name === "playback_entitlement") return { data: entitlement, error: null };
    if (name === "mark_upload_grant_failure") return { data: null, error: null };
    throw new Error("Unexpected internal RPC");
  });
  mocks.direct.mockResolvedValue(uploadGrant);
  mocks.remove.mockResolvedValue(undefined);
  mocks.token.mockResolvedValue(tokenGrant);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("upload authorization race contracts", () => {
  it("requires a bounded exact file size before any reservation or provider request", async () => {
    for (const fileSize of [undefined, 0, -1, 500000001, 1.5, "329742172"]) {
      const response = await upload(
        new Request("http://localhost:3000/api/studio/uploads", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({
            versionId: version,
            idempotencyKey: "stable-operation-key-001",
            fileSize,
          }),
        }),
      );
      expect(response.status).toBe(400);
      await errorBody(response);
    }
    expect(mocks.userRpc).not.toHaveBeenCalled();
    expect(mocks.direct).not.toHaveBeenCalled();
  });

  it("passes the large file size and quota-bound duration to TUS creation without exposing its private ID", async () => {
    mocks.userRpc.mockResolvedValue({
      data: { ...reservationResult, max_duration_seconds: 1063 },
      error: null,
    });
    mocks.direct.mockResolvedValue({
      ...uploadGrant,
      protocol: "tus",
      uploadUrl: "https://upload.videodelivery.net/tus/opaque_credential",
    });
    const response = await upload(
      new Request("http://localhost:3000/api/studio/uploads", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({
          versionId: version,
          idempotencyKey: "stable-operation-key-001",
          fileSize: 329742172,
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.direct).toHaveBeenCalledExactlyOnceWith({
      creatorId: owner,
      operationKey: reservation,
      maxDurationSeconds: 1063,
      expiresAt: new Date(reservationResult.expires_at),
      fileSize: 329742172,
    });
    expect(await response.json()).toEqual({
      accountId: owner,
      versionId: version,
      reservationId: reservation,
      expiresAt: reservationResult.expires_at,
      protocol: "tus",
      fileSize: 329742172,
      uploadUrl: "https://upload.videodelivery.net/tus/opaque_credential",
    });
  });

  it.each(["hide", "stale revision", "suspension"])(
    "withholds the grant if %s makes binding unusable during provider creation",
    async () => {
      const started = deferred<void>();
      const create = deferred<typeof uploadGrant>();
      let usable = true;
      mocks.direct.mockImplementation(async () => {
        started.resolve();
        return create.promise;
      });
      mocks.adminRpc.mockImplementation(async (name: string) =>
        name === "bind_video_provider"
          ? { data: { usable }, error: null }
          : { data: { lease: true, operation_key: reservation }, error: null },
      );
      const pending = upload(uploadRequest());
      await started.promise;
      expect(mocks.adminRpc.mock.calls.some(([name]) => name === "bind_video_provider")).toBe(
        false,
      );
      usable = false;
      create.resolve(uploadGrant);
      const response = await pending;
      expect(response.status).toBe(409);
      await errorBody(response);
      expect(mocks.adminRpc).toHaveBeenCalledWith("bind_video_provider", {
        reservation_id: reservation,
        provider_uid: providerUid,
      });
      expect(mocks.remove).not.toHaveBeenCalled(); // SQL has durably queued this asset.
      expect(mocks.direct).toHaveBeenCalledExactlyOnceWith({
        creatorId: owner,
        fileSize: 158829024,
        operationKey: reservation,
        maxDurationSeconds: 180,
        expiresAt: new Date(reservationResult.expires_at),
      });
    },
  );

  it("records uncertainty and compensates after a binding RPC failure without leaking provider details", async () => {
    mocks.adminRpc.mockImplementation(async (name: string) => {
      if (name === "begin_upload_grant")
        return { data: { lease: true, operation_key: reservation }, error: null };
      if (name === "bind_video_provider")
        return { data: null, error: { code: "XX000", message: "private_database_details" } };
      return { data: null, error: null };
    });
    mocks.remove.mockRejectedValue(new Error("private_provider_failure"));
    const response = await upload(uploadRequest());
    expect(response.status).toBe(502);
    await errorBody(response);
    expect(mocks.adminRpc).toHaveBeenCalledWith("mark_upload_grant_failure", {
      reservation_id: reservation,
      known_no_asset: false,
      error_message: "Provider operation needs reconciliation",
    });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(providerUid);
  });

  it.each(["provider", "admin", "uploads flag"])(
    "rejects missing %s configuration before reserving capacity",
    async (missing) => {
      if (missing === "provider") mocks.config.mockReturnValue(null);
      if (missing === "admin") mocks.admin.mockReturnValue(null);
      if (missing === "uploads flag") vi.stubEnv("AIVERSE_ENABLE_STREAM_UPLOADS", "false");
      const response = await upload(uploadRequest());
      expect(response.status).toBe(503);
      await errorBody(response);
      expect(mocks.userRpc).not.toHaveBeenCalled();
      expect(mocks.adminRpc).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
    },
  );

  it("rejects a cross-origin request before session, quota or provider operations", async () => {
    const response = await upload(uploadRequest("https://other.test"));
    expect(response.status).toBe(403);
    await errorBody(response);
    expect(mocks.server).not.toHaveBeenCalled();
    expect(mocks.userRpc).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("does not authorize an upload for an absent verified account", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await upload(uploadRequest());
    expect(response.status).toBe(401);
    await errorBody(response);
    expect(mocks.userRpc).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("does not repeat a provider creation for an already-started operation", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: { lease: false, operation_state: "uncertain" },
      error: null,
    });
    const response = await upload(uploadRequest());
    expect(response.status).toBe(409);
    await errorBody(response);
    expect(mocks.direct).not.toHaveBeenCalled();
  });

  it("returns the authorized grant only after usable binding, without exposing its private asset identifier", async () => {
    const response = await upload(uploadRequest());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      accountId: owner,
      versionId: version,
      uploadUrl: privateUploadUrl,
      expiresAt: uploadGrant.expiresAt,
      protocol: "multipart",
      fileSize: 158829024,
      reservationId: reservation,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.adminRpc.mock.calls.map(([name]) => name)).toEqual([
      "begin_upload_grant",
      "bind_video_provider",
    ]);
  });
});

describe("playback grant races and absolute database expiry", () => {
  it("discards a token when access is revoked while the provider request is running", async () => {
    const started = deferred<void>();
    const grant = deferred<typeof tokenGrant>();
    let revoked = false;
    mocks.adminRpc.mockImplementation(async () => ({
      data: revoked ? null : entitlement,
      error: null,
    }));
    mocks.token.mockImplementation(async () => {
      started.resolve();
      return grant.promise;
    });
    const pending = playbackRequest();
    await started.promise;
    revoked = true;
    grant.resolve(tokenGrant);
    const response = await pending;
    expect(response.status).toBe(404);
    await errorBody(response);
    expect(mocks.adminRpc).toHaveBeenCalledTimes(2);
    expect(mocks.token).toHaveBeenCalledExactlyOnceWith(
      providerUid,
      60,
      Math.floor(now / 1000) + 60,
    );
  });

  it.each(["version", "provider"])(
    "discards a token if its %s identity changed before the response",
    async (change) => {
      mocks.adminRpc
        .mockResolvedValueOnce({ data: entitlement, error: null })
        .mockResolvedValueOnce({
          data: {
            ...entitlement,
            ...(change === "version"
              ? { version_id: replacement }
              : { provider_uid: "c".repeat(32) }),
          },
          error: null,
        });
      const response = await playbackRequest();
      expect(response.status).toBe(404);
      await errorBody(response);
    },
  );

  it("rejects a provider token whose expiry exceeds the original absolute SQL deadline", async () => {
    mocks.token.mockResolvedValue({ token: privateToken, expiresAt: Math.floor(now / 1000) + 61 });
    const response = await playbackRequest();
    expect(response.status).toBe(404);
    await errorBody(response);
    expect(mocks.token.mock.calls[0][2]).toBe(Math.floor(Date.parse(absoluteDeadline) / 1000));
  });

  it("returns an allowed short grant only after revalidation, with no caching", async () => {
    const response = await playbackRequest();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      iframeUrl: `https://iframe.videodelivery.net/${privateToken}`,
      expiresAt: tokenGrant.expiresAt,
      versionId: version,
      durationSeconds: 90,
      tracking: null,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.token).toHaveBeenCalledExactlyOnceWith(
      providerUid,
      60,
      Math.floor(now / 1000) + 60,
    );
    for (const call of mocks.adminRpc.mock.calls)
      expect(call).toEqual([
        "playback_entitlement",
        { video_id: video, viewer_id: owner, requested_version_id: null },
      ]);
  });

  it("fails closed on private provider errors without returning token or asset details", async () => {
    mocks.token.mockRejectedValue(new Error("private_provider_failure"));
    const response = await playbackRequest();
    expect(response.status).toBe(502);
    await errorBody(response);
  });

  it("avoids provider I/O when the initial entitlement is absent or nearly expired", async () => {
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: null });
    const absent = await playbackRequest();
    expect(absent.status).toBe(404);
    await errorBody(absent);
    mocks.adminRpc.mockResolvedValueOnce({
      data: { ...entitlement, expires_at: new Date(now + 4000).toISOString() },
      error: null,
    });
    const expiring = await playbackRequest();
    expect(expiring.status).toBe(409);
    await errorBody(expiring);
    expect(mocks.token).not.toHaveBeenCalled();
  });
});
