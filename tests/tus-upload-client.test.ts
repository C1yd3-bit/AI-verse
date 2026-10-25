import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseUploadGrant, transferVideo } from "../src/features/media/upload-client";
import { TUS_CHUNK_BYTES } from "../src/features/media/tus-client";

const accountId = "96100000-0000-4000-8000-000000000001";
const versionId = "96100000-0000-4000-8000-000000000002";
const now = Date.parse("2026-10-25T12:00:00Z");
const fileSize = 200_000_001;
const raw = {
  accountId,
  versionId,
  reservationId: "96100000-0000-4000-8000-000000000003",
  protocol: "tus",
  fileSize,
  uploadUrl: "https://upload.videodelivery.net/tus/opaque_Grant-1",
  expiresAt: new Date(now + 60_000).toISOString(),
};
class MockXHR {
  upload = {
    onprogress: null as
      ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  withCredentials = true;
  timeout = 0;
  status = 200;
  responseURL = raw.uploadUrl;
  responseHeaders: Record<string, string> = {
    "Tus-Resumable": "1.0.0",
    "Upload-Length": String(fileSize),
    "Upload-Offset": "0",
  };
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  setRequestHeader = vi.fn();
  getResponseHeader = vi.fn((name: string) => this.responseHeaders[name] ?? null);
  complete(status = 200, headers: Record<string, string> = {}) {
    this.status = status;
    this.responseHeaders = { ...this.responseHeaders, ...headers };
    this.onload!();
  }
}
let requests: MockXHR[];
let controller: AbortController;
let progress: ReturnType<typeof vi.fn<(percentage: number | null) => void>>;
let appendChild: ReturnType<typeof vi.fn>;
let file: File;
let slice: ReturnType<typeof vi.spyOn>;
async function flush() {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}
function transfer(grant = parseUploadGrant(raw, accountId, versionId)) {
  return transferVideo({
    grant,
    file,
    signal: controller.signal,
    onProgress: progress,
    xhrFactory: () => {
      const xhr = new MockXHR();
      requests.push(xhr);
      return xhr as unknown as XMLHttpRequest;
    },
    document: { createElement: () => ({}), head: { appendChild } } as unknown as Document,
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  requests = [];
  controller = new AbortController();
  progress = vi.fn();
  appendChild = vi.fn();
  file = new File(["video"], "film.mp4", { type: "video/mp4" });
  vi.spyOn(file, "size", "get").mockReturnValue(fileSize);
  // No 200 MB allocation: assert each requested byte range, hand XHR a sized Blob stand-in.
  slice = vi.spyOn(file, "slice").mockImplementation((start = 0, end = fileSize) => {
    const chunk = new Blob(["video"]);
    Object.defineProperty(chunk, "size", { value: end - start });
    return chunk;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("bounded sequential TUS transfer of a server-created resource", () => {
  it("HEADs the existing capability, sends aligned sequential PATCHes and confirms the exact final byte", async () => {
    const pending = transfer();
    expect(requests[0].open).toHaveBeenCalledWith("HEAD", raw.uploadUrl, true);
    expect(requests[0].send).toHaveBeenCalledWith(null);
    expect(requests[0].setRequestHeader.mock.calls).toEqual([["Tus-Resumable", "1.0.0"]]);
    expect(appendChild).toHaveBeenCalledWith({ name: "referrer", content: "no-referrer" });
    requests[0].complete();
    await flush();
    let offset = 0;
    while (offset < fileSize) {
      const xhr = requests.at(-1)!;
      const expectedSize = Math.min(TUS_CHUNK_BYTES, fileSize - offset);
      expect(xhr.open).toHaveBeenCalledWith("PATCH", raw.uploadUrl, true);
      expect(xhr.setRequestHeader.mock.calls).toEqual([
        ["Tus-Resumable", "1.0.0"],
        ["Upload-Offset", String(offset)],
        ["Content-Type", "application/offset+octet-stream"],
      ]);
      expect((xhr.send.mock.calls[0][0] as Blob).size).toBe(expectedSize);
      expect(xhr.withCredentials).toBe(false);
      expect(xhr.timeout).toBe(60_000);
      expect(slice).toHaveBeenLastCalledWith(offset, offset + expectedSize);
      offset += expectedSize;
      xhr.complete(204, { "Upload-Offset": String(offset) });
      await flush();
    }
    await pending;
    expect(TUS_CHUNK_BYTES % (256 * 1024)).toBe(0);
    expect(TUS_CHUNK_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    expect(requests).toHaveLength(1 + Math.ceil(fileSize / TUS_CHUNK_BYTES));
    expect(requests.every((xhr) => xhr.open.mock.calls[0][0] !== "POST")).toBe(true);
    expect(progress).toHaveBeenLastCalledWith(100);
    expect(vi.getTimerCount()).toBe(0);
    expect(requests.every((xhr) => xhr.onload === null && xhr.upload.onprogress === null)).toBe(
      true,
    );
  });
  it("can continue a validated partial offset on the same grant and measures aggregate uploaded bytes", async () => {
    const pending = transfer();
    requests[0].complete(200, { "Upload-Offset": String(fileSize - 1000) });
    await flush();
    const patch = requests[1];
    patch.upload.onprogress!({ loaded: 500, total: 1000, lengthComputable: true });
    expect(progress).toHaveBeenLastCalledWith(99);
    patch.upload.onprogress!({ loaded: 500, total: 0, lengthComputable: false });
    expect(progress).toHaveBeenLastCalledWith(null);
    patch.complete(204, { "Upload-Offset": String(fileSize) });
    await pending;
    expect(slice).toHaveBeenCalledWith(fileSize - 1000, fileSize);
    expect(requests).toHaveLength(2);
  });
  it("confirms an already complete matching resource without a PATCH", async () => {
    const pending = transfer();
    requests[0].complete(200, { "Upload-Offset": String(fileSize) });
    await pending;
    expect(requests).toHaveLength(1);
    expect(slice).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(100);
  });
  it("does not confirm a final response received after the grant deadline, even before its timer callback", async () => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("did not confirm");
    vi.setSystemTime(now + 60_000);
    requests[0].complete(200, { "Upload-Offset": String(fileSize) });
    await rejected;
    expect(progress).not.toHaveBeenCalledWith(100);
    expect(requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ["Tus-Resumable", "0.2.2"],
    ["Tus-Resumable", ""],
    ["Upload-Length", String(fileSize + 1)],
    ["Upload-Length", "0200000001"],
    ["Upload-Offset", "-1"],
    ["Upload-Offset", "1.5"],
    ["Upload-Offset", "0junk"],
    ["Upload-Offset", String(fileSize + 1)],
    ["Upload-Offset", "9007199254740992"],
  ])("fails closed on HEAD %s=%s without a PATCH or second grant", async (name, value) => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("did not confirm");
    requests[0].complete(200, { [name]: value });
    await rejected;
    expect(requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["missing offset", "bad status", "redirect", "wrong tus", "wrong offset"])(
    "does not continue after ambiguous PATCH: %s",
    async (scenario) => {
      const pending = transfer();
      const rejected = expect(pending).rejects.toThrow("did not confirm");
      requests[0].complete();
      await flush();
      const patch = requests[1];
      patch.responseHeaders["Upload-Offset"] = String(TUS_CHUNK_BYTES);
      if (scenario === "missing offset") delete patch.responseHeaders["Upload-Offset"];
      if (scenario === "redirect") patch.responseURL = "https://other.test/resource";
      if (scenario === "wrong tus") patch.responseHeaders["Tus-Resumable"] = "2.0.0";
      if (scenario === "wrong offset")
        patch.responseHeaders["Upload-Offset"] = String(TUS_CHUNK_BYTES - 1);
      patch.complete(scenario === "bad status" ? 200 : 204);
      await rejected;
      expect(requests).toHaveLength(2);
      expect(progress).not.toHaveBeenLastCalledWith(100);
    },
  );
  it.each(["onerror", "ontimeout", "onabort"] as const)(
    "keeps an uncertain %s terminal with no HEAD/PATCH retry",
    async (event) => {
      const pending = transfer();
      const rejected = expect(pending).rejects.toThrow("Refresh status");
      requests[0].complete();
      await flush();
      requests[1][event]!();
      await rejected;
      expect(requests).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("aborts the active chunk, suppresses late progress and never starts another chunk", async () => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("cancelled");
    requests[0].complete();
    await flush();
    const patch = requests[1];
    const lateLoad = patch.onload!;
    const lateProgress = patch.upload.onprogress!;
    controller.abort();
    await rejected;
    lateProgress({ loaded: TUS_CHUNK_BYTES, total: TUS_CHUNK_BYTES, lengthComputable: true });
    lateLoad();
    await flush();
    expect(patch.abort).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
    expect(progress.mock.calls).toEqual([[0]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores malformed progress totals and bounds observed bytes to the current chunk", async () => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("cancelled");
    requests[0].complete();
    await flush();
    const patch = requests[1];
    for (const values of [
      { loaded: NaN, total: TUS_CHUNK_BYTES },
      { loaded: -1, total: TUS_CHUNK_BYTES },
      { loaded: 1, total: TUS_CHUNK_BYTES + 1 },
    ]) {
      patch.upload.onprogress!({ ...values, lengthComputable: true });
      expect(progress).toHaveBeenLastCalledWith(null);
    }
    patch.upload.onprogress!({
      loaded: TUS_CHUNK_BYTES * 2,
      total: TUS_CHUNK_BYTES,
      lengthComputable: true,
    });
    expect(progress).toHaveBeenLastCalledWith(Math.floor((TUS_CHUNK_BYTES / fileSize) * 100));
    controller.abort();
    await rejected;
  });
  it("bounds the whole transfer by one deadline, rather than resetting the allowance per chunk", async () => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(20_000);
    requests[0].complete();
    await flush();
    expect(requests[1].timeout).toBe(40_000);
    await vi.advanceTimersByTimeAsync(40_000);
    await rejected;
    expect(requests[1].abort).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
  });
  it("caps a long grant to fifteen minutes and stops if expiry arrives between acknowledgements", async () => {
    const grant = parseUploadGrant(
      { ...raw, expiresAt: new Date(now + 3_600_000).toISOString() },
      accountId,
      versionId,
    );
    const pending = transfer(grant);
    const rejected = expect(pending).rejects.toThrow("timed out");
    expect(requests[0].timeout).toBe(900_000);
    await vi.advanceTimersByTimeAsync(900_000);
    await rejected;
    expect(requests).toHaveLength(1);
  });
  it("refuses an already aborted or expired grant before any request", async () => {
    controller.abort();
    await expect(transfer()).rejects.toThrow();
    expect(requests).toHaveLength(0);
    controller = new AbortController();
    const grant = parseUploadGrant(raw, accountId, versionId);
    vi.setSystemTime(now + 60_001);
    await expect(transfer(grant)).rejects.toThrow("expired");
    expect(requests).toHaveLength(0);
  });
  it("does not PATCH when HEAD is redirected or denied", async () => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("did not confirm");
    requests[0].responseURL = "https://other.test/resource";
    requests[0].complete(403);
    await rejected;
    expect(requests).toHaveLength(1);
  });
  it("aborts a synchronous send failure and leaves the grant uncertain", async () => {
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("could not start");
    requests[0].complete();
    await flush();
    requests[1].complete(204, { "Upload-Offset": String(TUS_CHUNK_BYTES) });
    // The next request is created synchronously by the continuation on its microtask.
    const push = vi.spyOn(requests, "push").mockImplementation((xhr: MockXHR) => {
      xhr.send.mockImplementation(() => {
        throw new Error("secret");
      });
      return Array.prototype.push.call(requests, xhr);
    });
    await rejected;
    push.mockRestore();
    expect(requests.at(-1)!.abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start a PATCH when the selected slice no longer has the promised bytes", async () => {
    slice.mockReturnValueOnce(new Blob([]));
    const pending = transfer();
    const rejected = expect(pending).rejects.toThrow("file changed");
    requests[0].complete();
    await rejected;
    expect(requests).toHaveLength(1);
  });
});
