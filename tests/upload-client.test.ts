import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  parseUploadGrant,
  readUploadResponse,
  readUploadJournal,
  transferVideo,
  uploadJournalKey,
  validUploadFile,
  writeUploadJournal,
} from "../src/features/media/upload-client";

const accountId = "96000000-0000-4000-8000-000000000001";
const versionId = "96000000-0000-4000-8000-000000000002";
const reservationId = "96000000-0000-4000-8000-000000000003";
const requestKey = "96000000-0000-4000-8000-000000000004";
const now = Date.parse("2026-10-25T12:00:00Z");
const rawGrant = {
  accountId,
  versionId,
  reservationId,
  uploadUrl: `https://upload.videodelivery.net/${"a".repeat(32)}`,
  expiresAt: new Date(now + 60_000).toISOString(),
  protocol: "multipart",
  fileSize: 5,
};
class MockXHR {
  upload = {
    onprogress: null as
      ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  withCredentials = true;
  timeout = 0;
  status = 200;
  responseURL = rawGrant.uploadUrl;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
}
let xhr: MockXHR;
let appendChild: ReturnType<typeof vi.fn>;
let progress: ReturnType<typeof vi.fn<(percentage: number | null) => void>>;
let controller: AbortController;
const file = new File(["video"], "film.mp4", { type: "video/mp4" });
function transfer(
  grant = parseUploadGrant(rawGrant, accountId, versionId),
  signal = controller.signal,
) {
  return transferVideo({
    grant,
    file,
    signal,
    onProgress: progress,
    xhrFactory: () => xhr as unknown as XMLHttpRequest,
    document: { createElement: () => ({}), head: { appendChild } } as unknown as Document,
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  xhr = new MockXHR();
  appendChild = vi.fn();
  progress = vi.fn();
  controller = new AbortController();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("upload capability and recovery boundaries", () => {
  it("bounds JSON authorization by actual bytes and cancels malformed/oversized bodies", async () => {
    expect(await readUploadResponse(Response.json(rawGrant), controller.signal)).toEqual(rawGrant);
    await expect(readUploadResponse(new Response("not JSON"), controller.signal)).rejects.toThrow();
    await expect(
      readUploadResponse(new Response("x".repeat(8193)), controller.signal),
    ).rejects.toThrow("too large");
    await expect(
      readUploadResponse(
        new Response("{}", { headers: { "content-length": "8193" } }),
        controller.signal,
      ),
    ).rejects.toThrow("unavailable");
    controller.abort();
    await expect(readUploadResponse(Response.json(rawGrant), controller.signal)).rejects.toThrow(
      "cancelled",
    );
  });
  it("accepts only the exact owner/version and bounded canonical grant", () => {
    expect(parseUploadGrant(rawGrant, accountId, versionId).expiresAtMs).toBe(now + 60_000);
    expect(() => parseUploadGrant(rawGrant, reservationId, versionId)).toThrow();
    expect(() => parseUploadGrant(rawGrant, accountId, reservationId)).toThrow();
  });
  it.each([
    `http://upload.videodelivery.net/${"a".repeat(32)}`,
    `https://upload.videodelivery.net.evil.test/${"a".repeat(32)}`,
    `https://upload.videodelivery.net/${"a".repeat(32)}?secret=x`,
    `https://upload.videodelivery.net/${"a".repeat(32)}#x`,
    `https://user@upload.videodelivery.net/${"a".repeat(32)}`,
    `https://upload.videodelivery.net:443/${"a".repeat(32)}`,
    `https://upload.videodelivery.net/${"a".repeat(32)}/`,
    `https://upload.videodelivery.net/%61${"a".repeat(31)}`,
    `https://upload.videodelivery.net/${"a".repeat(32)}/../${"a".repeat(32)}`,
  ])("rejects noncanonical upload destination %s", (uploadUrl) => {
    expect(() => parseUploadGrant({ ...rawGrant, uploadUrl }, accountId, versionId)).toThrow();
  });
  it.each([0, -1, 3_600_001, NaN])("rejects invalid expiry offset %s", (offset) => {
    const expiresAt = Number.isFinite(offset) ? new Date(now + offset).toISOString() : "invalid";
    expect(() => parseUploadGrant({ ...rawGrant, expiresAt }, accountId, versionId)).toThrow();
  });
  it("rejects extra fields and absent reservation identity", () => {
    expect(() =>
      parseUploadGrant({ ...rawGrant, token: "private" }, accountId, versionId),
    ).toThrow();
    expect(() =>
      parseUploadGrant({ ...rawGrant, reservationId: null }, accountId, versionId),
    ).toThrow();
  });
  it("binds size and protocol at the multipart threshold and refuses missing size/protocol", () => {
    expect(() =>
      parseUploadGrant({ ...rawGrant, fileSize: undefined }, accountId, versionId),
    ).toThrow();
    expect(() =>
      parseUploadGrant({ ...rawGrant, protocol: undefined }, accountId, versionId),
    ).toThrow();
    expect(() =>
      parseUploadGrant({ ...rawGrant, fileSize: 200_000_001 }, accountId, versionId),
    ).toThrow();
    expect(() =>
      parseUploadGrant({ ...rawGrant, protocol: "tus" }, accountId, versionId),
    ).toThrow();
    expect(() => parseUploadGrant(rawGrant, accountId, versionId, now, 6)).toThrow();
    expect(
      parseUploadGrant({ ...rawGrant, fileSize: 200_000_000 }, accountId, versionId).protocol,
    ).toBe("multipart");
    expect(
      parseUploadGrant(
        {
          ...rawGrant,
          fileSize: 500_000_000,
          protocol: "tus",
          uploadUrl: "https://upload.videodelivery.net/tus/opaque_Grant-1",
        },
        accountId,
        versionId,
      ).protocol,
    ).toBe("tus");
    expect(() =>
      parseUploadGrant(
        { ...rawGrant, fileSize: 500_000_001, protocol: "tus" },
        accountId,
        versionId,
      ),
    ).toThrow();
  });
  it("enforces binary size, name and MIME without reading or storing file contents", () => {
    expect(validUploadFile(file)).toBe(true);
    expect(validUploadFile(new File([], "film.mp4"))).toBe(false);
    expect(validUploadFile(new File(["x"], "film.svg", { type: "video/mp4" }))).toBe(false);
    expect(validUploadFile(new File(["x"], "film.mov", { type: "text/html" }))).toBe(false);
    const size = vi.spyOn(file, "size", "get");
    size.mockReturnValue(MAX_UPLOAD_BYTES);
    expect(validUploadFile(file)).toBe(true);
    size.mockReturnValue(MAX_UPLOAD_BYTES + 1);
    expect(validUploadFile(file)).toBe(false);
  });
  it("persists a stable per-account/version latch without capabilities and fails closed on corruption/storage loss", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    writeUploadJournal(storage, accountId, versionId, { requestKey, phase: "started" });
    expect(readUploadJournal(storage, accountId, versionId)).toEqual({
      requestKey,
      phase: "started",
    });
    expect(readUploadJournal(storage, reservationId, versionId)).toBeNull();
    expect(readUploadJournal(storage, accountId, reservationId)).toBeNull();
    expect([...values.values()].join()).not.toContain("uploadUrl");
    values.set(uploadJournalKey(accountId, versionId), "broken");
    expect(() => readUploadJournal(storage, accountId, versionId)).toThrow();
    expect(() =>
      writeUploadJournal({ getItem: () => null, setItem() {} }, accountId, versionId, {
        requestKey,
        phase: "started",
      }),
    ).toThrow();
  });
});
describe("actual XHR upload lifecycle", () => {
  it("does not start a mismatched file, size or protocol even for an already parsed grant", async () => {
    const grant = parseUploadGrant(rawGrant, accountId, versionId);
    await expect(transfer({ ...grant, fileSize: 6 })).rejects.toThrow("changed");
    await expect(transfer({ ...grant, protocol: "tus" })).rejects.toThrow("changed");
    expect(xhr.open).not.toHaveBeenCalled();
  });
  it("aborts a failed send and clears its deadline", async () => {
    xhr.send.mockImplementationOnce(() => {
      throw new Error("private transport error");
    });
    await expect(transfer()).rejects.toThrow("could not start");
    expect(xhr.abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("sends multipart without credentials/referrer and reports observed transfer progress", async () => {
    const pending = transfer();
    expect(appendChild).toHaveBeenCalledWith({ name: "referrer", content: "no-referrer" });
    expect(xhr.open).toHaveBeenCalledWith("POST", rawGrant.uploadUrl, true);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.timeout).toBe(60_000);
    expect((xhr.send.mock.calls[0][0] as FormData).get("file")).toBe(file);
    xhr.upload.onprogress!({ loaded: 10, total: 100, lengthComputable: true });
    xhr.upload.onprogress!({ loaded: 150, total: 100, lengthComputable: true });
    expect(progress.mock.calls).toEqual([[10], [100]]);
    xhr.onload!();
    await pending;
    expect(xhr.onload).toBeNull();
    expect(xhr.upload.onprogress).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps progress indeterminate without a measured total", async () => {
    const pending = transfer();
    xhr.upload.onprogress!({ loaded: 10, total: 0, lengthComputable: false });
    expect(progress).toHaveBeenCalledWith(null);
    xhr.onload!();
    await pending;
  });
  it.each(["onerror", "ontimeout", "onabort"] as const)("settles safely on %s", async (event) => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow(/Refresh status/);
    xhr[event]!();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects provider failure without reflecting private response content", async () => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("service did not confirm");
    xhr.status = 500;
    xhr.onload!();
    await rejected;
  });
  it("aborts at the earlier grant deadline, ignores late events and never retries", async () => {
    const pending = transfer();
    const late = xhr.onload!;
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    late();
    expect(xhr.abort).toHaveBeenCalledOnce();
    expect(xhr.send).toHaveBeenCalledOnce();
  });
  it("cancels an in-flight transfer and removes listeners/timers", async () => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("cancelled");
    controller.abort();
    await rejected;
    expect(xhr.abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not create a transfer for an already aborted owner", async () => {
    controller.abort();
    await expect(transfer()).rejects.toThrow("cancelled");
    expect(xhr.send).not.toHaveBeenCalled();
    expect(appendChild).not.toHaveBeenCalled();
  });
  it("does not send an already expired capability or confirm a redirected response", async () => {
    const grant = parseUploadGrant(rawGrant, accountId, versionId);
    vi.setSystemTime(now + 60_001);
    await expect(transfer(grant)).rejects.toThrow("expired");
    expect(xhr.send).not.toHaveBeenCalled();
    vi.setSystemTime(now);
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("did not confirm");
    xhr.responseURL = "https://other.test/";
    xhr.onload!();
    await rejected;
  });
});
