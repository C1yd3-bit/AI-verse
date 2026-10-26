import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_MAX_UPLOAD_BYTES,
  parseStorageGrant,
  parseStorageRecovery,
  parseStorageCompletion,
  readStorageResponse,
  validStorageFile,
  readStorageJournal,
  writeStorageJournal,
  transferStorageVideo,
} from "../src/features/media/storage-upload-client";
const accountId = "96000000-0000-4000-8000-000000000001";
const versionId = "96000000-0000-4000-8000-000000000002";
const reservationId = "96000000-0000-4000-8000-000000000003";
const requestKey = "96000000-0000-4000-8000-000000000004";
const origin = "https://project.supabase.co";
const now = Date.parse("2026-10-26T00:00:00Z");
const path = `/storage/v1/object/upload/sign/aiverse-videos/${accountId}/${versionId}/${reservationId}.mp4`;
const raw = {
  accountId,
  versionId,
  reservationId,
  uploadUrl: `${origin}${path}?token=opaque.token`,
  protocol: "supabase",
  expiresAt: new Date(now + 900_000).toISOString(),
  fileSize: 5,
};
const file = new File(["video"], "private.mp4", { type: "video/mp4" });
class XHR {
  upload = {
    onprogress: null as
      ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  withCredentials = true;
  timeout = 0;
  status = 200;
  responseURL = raw.uploadUrl;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  setRequestHeader = vi.fn();
}
let xhr: XHR;
let controller: AbortController;
let progress: ReturnType<typeof vi.fn<(value: number | null) => void>>;
function transfer(
  grant = parseStorageGrant(raw, accountId, versionId, origin, file.size),
  selected = file,
) {
  return transferStorageVideo({
    grant,
    configuredUrl: origin,
    file: selected,
    signal: controller.signal,
    onProgress: progress,
    xhrFactory: () => xhr as unknown as XMLHttpRequest,
    document: { createElement: () => ({}), head: { appendChild: vi.fn() } } as unknown as Document,
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  xhr = new XHR();
  controller = new AbortController();
  progress = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("private Supabase upload capability boundaries", () => {
  it("accepts only the configured project's exact owner/version/reservation resource", () => {
    expect(parseStorageGrant(raw, accountId, versionId, origin, 5).expiresAtMs).toBe(now + 900_000);
    for (const changed of [
      { accountId: requestKey },
      { versionId: requestKey },
      { reservationId: requestKey },
      { fileSize: 6 },
      { protocol: "tus" },
      { extra: true },
    ])
      expect(() =>
        parseStorageGrant({ ...raw, ...changed }, accountId, versionId, origin, 5),
      ).toThrow();
  });
  it.each([
    `${origin}.evil.test${path}?token=opaque`,
    `${origin}${path}?token=opaque&upsert=true`,
    `${origin}${path}?token=opaque#x`,
    `${origin}${path}?token=opaque&token=twice`,
    `${origin}${path}?token=%6fpaque`,
    `${origin}${path.replace(versionId, requestKey)}?token=opaque`,
    `http://project.supabase.co${path}?token=opaque`,
    `https://user@project.supabase.co${path}?token=opaque`,
    `https://project.supabase.co:443${path}?token=opaque`,
    `${origin}${path}/?token=opaque`,
  ])("rejects a noncanonical or unrelated upload resource %s", (uploadUrl) => {
    expect(() =>
      parseStorageGrant({ ...raw, uploadUrl }, accountId, versionId, origin, 5),
    ).toThrow();
  });
  it("permits HTTP only for the configured loopback service", () => {
    const local = "http://127.0.0.1:55321";
    expect(
      parseStorageGrant(
        { ...raw, uploadUrl: `${local}${path}?token=opaque` },
        accountId,
        versionId,
        local,
        5,
      ).protocol,
    ).toBe("supabase");
    expect(() =>
      parseStorageGrant(
        { ...raw, uploadUrl: `http://remote.test${path}?token=opaque` },
        accountId,
        versionId,
        "http://remote.test",
        5,
      ),
    ).toThrow();
  });
  it.each([-1, 0, 905001])("rejects an expired or excessive expiry offset %s", (offset) => {
    expect(() =>
      parseStorageGrant(
        { ...raw, expiresAt: new Date(now + offset).toISOString() },
        accountId,
        versionId,
        origin,
        5,
      ),
    ).toThrow();
  });
  it("enforces MP4 and exact 50 MB input limits before authorization", () => {
    expect(validStorageFile(file)).toBe(true);
    expect(validStorageFile(new File(["x"], "film.mov", { type: "video/quicktime" }))).toBe(false);
    expect(validStorageFile(new File(["x"], "film.mp4", { type: "text/html" }))).toBe(false);
    expect(validStorageFile(new File([], "empty.mp4"))).toBe(false);
    const size = vi.spyOn(file, "size", "get");
    size.mockReturnValue(STORAGE_MAX_UPLOAD_BYTES);
    expect(validStorageFile(file)).toBe(true);
    size.mockReturnValue(STORAGE_MAX_UPLOAD_BYTES + 1);
    expect(validStorageFile(file)).toBe(false);
  });
  it("validates recovery and completion identities rather than a bare success status", () => {
    expect(
      parseStorageRecovery(
        { accountId, versionId, reservationId, status: "reserved" },
        accountId,
        versionId,
      ).reservationId,
    ).toBe(reservationId);
    expect(() =>
      parseStorageRecovery(
        { accountId, versionId, reservationId: null, status: "reserved" },
        accountId,
        versionId,
      ),
    ).toThrow();
    expect(() =>
      parseStorageRecovery(
        { accountId: requestKey, versionId, reservationId, status: "reserved" },
        accountId,
        versionId,
      ),
    ).toThrow();
    expect(
      parseStorageCompletion(
        { accountId, versionId, reservationId, status: "pending_review" },
        accountId,
        versionId,
        reservationId,
      ).status,
    ).toBe("pending_review");
    expect(() =>
      parseStorageCompletion(
        { accountId, versionId, reservationId: requestKey, status: "pending_review" },
        accountId,
        versionId,
        reservationId,
      ),
    ).toThrow();
  });
  it("persists identifiers only and fails closed on unconfirmed or malformed storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const entry = { requestKey, reservationId, phase: "started" as const };
    writeStorageJournal(storage, accountId, versionId, entry);
    expect(readStorageJournal(storage, accountId, versionId)).toEqual(entry);
    expect(readStorageJournal(storage, requestKey, versionId)).toBeNull();
    expect([...values.values()].join()).not.toMatch(/token|uploadUrl|private.mp4/);
    expect(() =>
      writeStorageJournal({ getItem: () => null, setItem() {} }, accountId, versionId, entry),
    ).toThrow();
  });
  it("bounds response bytes and cancels unreadable or aborted responses", async () => {
    expect(await readStorageResponse(Response.json(raw), controller.signal)).toEqual(raw);
    await expect(
      readStorageResponse(new Response("x".repeat(16385)), controller.signal),
    ).rejects.toThrow("large");
    await expect(
      readStorageResponse(new Response("bad JSON"), controller.signal),
    ).rejects.toThrow();
    controller.abort();
    await expect(readStorageResponse(Response.json(raw), controller.signal)).rejects.toThrow(
      "cancelled",
    );
  });
});
describe("native measured Storage transfer", () => {
  it("uses SDK-compatible PUT multipart, no overwrite or credentials, and measured progress", async () => {
    const pending = transfer();
    expect(xhr.open).toHaveBeenCalledWith("PUT", raw.uploadUrl, true);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("x-upsert", "false");
    const payload = xhr.send.mock.calls[0][0] as FormData;
    expect(payload.get("cacheControl")).toBe("0");
    expect((payload.get("") as File).name).toBe("video.mp4");
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 37, total: 100 });
    expect(progress).toHaveBeenCalledWith(37);
    xhr.onload?.();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects a changed final destination, server failure and an expired parsed grant", async () => {
    const pending = transfer();
    xhr.responseURL = "https://other.test/redirect";
    xhr.onload?.();
    await expect(pending).rejects.toThrow("did not confirm");
    const grant = parseStorageGrant(raw, accountId, versionId, origin, 5);
    vi.advanceTimersByTime(900001);
    await expect(transfer(grant)).rejects.toThrow("changed");
  });
  it("cancels the network operation, suppresses late progress and clears timers", async () => {
    const pending = transfer();
    const late = xhr.upload.onprogress;
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(xhr.abort).toHaveBeenCalledOnce();
    late?.({ lengthComputable: true, loaded: 100, total: 100 });
    expect(progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects timeout and synchronous send failure without leaving a live request", async () => {
    const pending = transfer();
    vi.advanceTimersByTime(900000);
    await expect(pending).rejects.toThrow("timed out");
    expect(xhr.abort).toHaveBeenCalledOnce();
    xhr = new XHR();
    xhr.send.mockImplementation(() => {
      throw new Error("private transport error");
    });
    vi.setSystemTime(now);
    await expect(transfer()).rejects.toThrow("could not start");
    expect(vi.getTimerCount()).toBe(0);
  });
});
