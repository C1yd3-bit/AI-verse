import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountChangedEvent, accountUnavailableEvent } from "../src/lib/appearance";
import { uploadJournalKey } from "../src/features/media/upload-client";

type Store = { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }> };
const hooks = vi.hoisted(() => ({
  cursor: 0,
  state: null as Store | null,
  pending: [] as (() => void)[],
  writes: 0,
  transfer: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "upload-feedback",
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    const state = hooks.state!;
    if (!(index in state.values)) state.values[index] = initial;
    return [
      state.values[index],
      (value: unknown) => {
        hooks.writes++;
        state.values[index] = typeof value === "function" ? value(state.values[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    const state = hooks.state!;
    if (!(index in state.values)) state.values[index] = { current: initial };
    return state.values[index];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.cursor++;
    const state = hooks.state!;
    const previous = state.effects.get(index);
    if (previous && deps.every((value, offset) => Object.is(value, previous.deps[offset]))) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      state.effects.set(index, { deps, cleanup: effect() });
    });
  },
}));
vi.mock("../src/features/media/upload-client", async (original) => ({
  ...(await original<typeof import("../src/features/media/upload-client")>()),
  transferVideo: hooks.transfer,
}));
import { StudioUploadForm } from "../src/components/studio-upload-form";
type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const accountId = "97000000-0000-4000-8000-000000000001";
const versionId = "97000000-0000-4000-8000-000000000002";
const reservationId = "97000000-0000-4000-8000-000000000003";
const grant = () => ({
  accountId,
  versionId,
  reservationId,
  uploadUrl: `https://upload.videodelivery.net/${"a".repeat(32)}`,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  protocol: "multipart",
  fileSize: 6,
});
const validFile = new File(["sample"], "film.mp4", { type: "video/mp4" });
let state: Store;
let props: Parameters<typeof StudioUploadForm>[0];
let storage: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function elements(node: ReactNode): Node[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Node;
  return [
    element,
    ...[element.props.children].flat(Infinity).flatMap((child) => elements(child as ReactNode)),
  ];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return [(node as Node).props.children]
    .flat(Infinity)
    .map((child) => text(child as ReactNode))
    .join(" ");
}
function render() {
  hooks.cursor = 0;
  hooks.state = state;
  const result = StudioUploadForm(props);
  for (const effect of hooks.pending.splice(0)) effect();
  return elements(result);
}
function unmount() {
  for (const effect of state.effects.values()) effect.cleanup?.();
}
async function settle() {
  for (let index = 0; index < 25; index++) {
    await Promise.resolve();
    render();
  }
}
function submit(file: unknown = validFile) {
  const form = render().find((node) => node.type === "form")!;
  return (form.props.onSubmit as (event: unknown) => Promise<void>)({
    preventDefault() {},
    currentTarget: { file },
  });
}
function click(label: string) {
  const button = render().find((node) => node.type === "button" && text(node) === label)!;
  return (button.props.onClick as () => void)();
}
const journal = () => JSON.parse(storage.get(uploadJournalKey(accountId, versionId))!);
beforeEach(async () => {
  state = { values: [], effects: new Map() };
  hooks.pending = [];
  hooks.writes = 0;
  storage = new Map();
  props = {
    accountId,
    versionId,
    enabled: true,
    onUploaded: vi.fn(),
    onBusyChange: vi.fn(() => true),
  };
  hooks.transfer.mockReset().mockResolvedValue(undefined);
  fetchMock = vi.fn(async () => Response.json(grant(), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal(
    "FormData",
    class {
      constructor(private fields: Record<string, unknown>) {}
      get(name: string) {
        return this.fields[name] ?? null;
      }
    },
  );
  render();
  render();
  await settle();
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("actual immutable-revision upload handlers", () => {
  it("does not request a capability for disabled/invalid files or denied parent lock", async () => {
    props.enabled = false;
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    props.enabled = true;
    await submit(new File([], "film.mp4"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(render().map(text).join()).toContain("Choose an MP4 or MOV");
    props.onBusyChange = vi.fn(() => false);
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });
  it("persists before authorization, compares the account, and synchronously blocks duplicate submission", async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const pending = submit();
    await submit();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(journal().phase).toBe("started");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-AIVerse-Account"]).toBe(accountId);
    expect(JSON.parse(init.body).idempotencyKey).toBe(journal().requestKey);
    expect(JSON.parse(init.body).fileSize).toBe(validFile.size);
    response.resolve(Response.json(grant(), { status: 201 }));
    await pending;
    expect(journal().phase).toBe("sent");
    expect(props.onUploaded).toHaveBeenCalledOnce();
  });
  it("shows measured native progress, leaves 100% as transfer only, and waits for acknowledgement", async () => {
    const sent = deferred<void>();
    hooks.transfer.mockReturnValueOnce(sent.promise);
    const pending = submit();
    await settle();
    const parameters = hooks.transfer.mock.calls[0][0];
    parameters.onProgress(27);
    const progress = render().find((node) => node.type === "progress")!;
    expect(progress.props.value).toBe(27);
    expect(progress.props.max).toBe(100);
    parameters.onProgress(100);
    props.enabled = false;
    render();
    expect(props.onUploaded).not.toHaveBeenCalled();
    expect(journal().phase).toBe("started");
    expect(render().map(text).join()).toContain("Transfer progress only");
    expect(render().map(text).join()).not.toContain("Uploads are not enabled yet");
    sent.resolve();
    await pending;
    expect(render().map(text).join()).toContain("Processing and human review are still required");
  });
  it("returns keyboard focus to the recovery message after cancellation", async () => {
    const frames: (() => void)[] = [];
    Object.assign(window, {
      requestAnimationFrame: (callback: () => void) => {
        frames.push(callback);
        return frames.length;
      },
    });
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const pending = submit();
    click("Cancel upload");
    const status = render().find(
      (node) => node.props.role === "status" && node.props.tabIndex === -1,
    )!;
    const focus = vi.fn();
    (status.props.ref as { current: unknown }).current = { focus };
    frames.splice(0).forEach((frame) => frame());
    expect(focus).toHaveBeenCalledOnce();
    response.resolve(Response.json(grant()));
    await pending;
  });
  it.each([
    "invalid owner",
    "expired grant",
    "unsafe destination",
    "invalid response",
    "server failure",
    "wrong size",
    "wrong protocol",
  ])("latches %s without transfer or regrant after remount", async (scenario) => {
    const body = grant();
    if (scenario === "invalid owner") body.accountId = reservationId;
    if (scenario === "expired grant") body.expiresAt = new Date(0).toISOString();
    if (scenario === "unsafe destination") body.uploadUrl = "https://other.test/private";
    if (scenario === "wrong size") body.fileSize = 7;
    if (scenario === "wrong protocol") body.protocol = "tus";
    fetchMock.mockResolvedValueOnce(
      scenario === "invalid response"
        ? new Response("not JSON")
        : Response.json(body, { status: scenario === "server failure" ? 502 : 201 }),
    );
    await submit();
    expect(hooks.transfer).not.toHaveBeenCalled();
    expect(journal().phase).toBe("uncertain");
    unmount();
    state = { values: [], effects: new Map() };
    render();
    render();
    await submit();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(render().map(text).join()).toContain("already attempted");
  });
  it("persists an ambiguous authorization network failure before any remount", async () => {
    fetchMock.mockRejectedValueOnce(new Error("private network detail"));
    await submit();
    expect(journal().phase).toBe("uncertain");
    await submit();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(render().map(text).join()).not.toContain("private network detail");
  });
  it.each([accountChangedEvent, accountUnavailableEvent])(
    "invalidates an authorizing owner on %s and ignores its late grant",
    async (event) => {
      const response = deferred<Response>();
      fetchMock.mockReturnValueOnce(response.promise);
      const pending = submit();
      const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
      window.dispatchEvent(new Event(event));
      expect(signal.aborted).toBe(true);
      response.resolve(Response.json(grant()));
      await pending;
      expect(hooks.transfer).not.toHaveBeenCalled();
      expect(props.onUploaded).not.toHaveBeenCalled();
      expect(render().map(text).join()).toContain("Your account changed");
    },
  );
  it("cancels transfer without minting another grant, and ignores its late success", async () => {
    const sent = deferred<void>();
    hooks.transfer.mockReturnValueOnce(sent.promise);
    const pending = submit();
    await settle();
    const signal = hooks.transfer.mock.calls[0][0].signal;
    click("Cancel upload");
    expect(signal.aborted).toBe(true);
    sent.resolve();
    await pending;
    await submit();
    expect(props.onUploaded).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(render().map(text).join()).toContain("Upload cancelled");
  });
  it("aborts on unmount, keeps the pre-request latch and performs no stale React write", async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const pending = submit();
    unmount();
    const writes = hooks.writes;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    response.resolve(Response.json(grant()));
    await pending;
    expect(hooks.writes).toBe(writes);
    expect(journal().phase).toBe("uncertain");
    expect(hooks.transfer).not.toHaveBeenCalled();
  });
  it("fails closed if recovery storage cannot be confirmed before an HTTP side effect", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem() {} });
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(render().map(text).join()).toContain("storage is unavailable");
  });
  it("sends a full-film size and accepts only its matching TUS grant without persisting capabilities or file details", async () => {
    const large = new File(["video"], "full-film.mp4", { type: "video/mp4" });
    vi.spyOn(large, "size", "get").mockReturnValue(329_742_172);
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          ...grant(),
          protocol: "tus",
          fileSize: large.size,
          uploadUrl: "https://upload.videodelivery.net/tus/opaque_Grant-1",
        },
        { status: 201 },
      ),
    );
    await submit(large);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).fileSize).toBe(329_742_172);
    expect(hooks.transfer).toHaveBeenCalledOnce();
    expect(hooks.transfer.mock.calls[0][0].grant.protocol).toBe("tus");
    expect(journal().phase).toBe("sent");
    const stored = [...storage.values()].join();
    expect(stored).not.toMatch(/uploadUrl|fileSize|full-film|329742172|opaque/);
  });
});
