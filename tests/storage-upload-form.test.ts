import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountChangedEvent, accountUnavailableEvent } from "../src/lib/appearance";
import { storageJournalKey } from "../src/features/media/storage-upload-client";
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
  useId: () => "storage-feedback",
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    const state = hooks.state!;
    if (!(i in state.values)) state.values[i] = initial;
    return [
      state.values[i],
      (value: unknown) => {
        hooks.writes++;
        state.values[i] = typeof value === "function" ? value(state.values[i]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const i = hooks.cursor++;
    const state = hooks.state!;
    if (!(i in state.values)) state.values[i] = { current: initial };
    return state.values[i];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const i = hooks.cursor++;
    const state = hooks.state!;
    const previous = state.effects.get(i);
    if (previous && deps.every((value, offset) => Object.is(value, previous.deps[offset]))) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      state.effects.set(i, { deps, cleanup: effect() });
    });
  },
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../src/lib/env", () => ({
  getSupabaseConfig: () => ({ url: "https://project.supabase.co", key: "public-test-key" }),
}));
vi.mock("../src/features/media/storage-upload-client", async (original) => ({
  ...(await original<typeof import("../src/features/media/storage-upload-client")>()),
  transferStorageVideo: hooks.transfer,
}));
import { StorageUploadForm } from "../src/components/storage-upload-form";
type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const accountId = "97000000-0000-4000-8000-000000000001";
const versionId = "97000000-0000-4000-8000-000000000002";
const reservationId = "97000000-0000-4000-8000-000000000003";
const file = new File(["sample"], "film.mp4", { type: "video/mp4" });
const grant = () => ({
  accountId,
  versionId,
  reservationId,
  uploadUrl: `https://project.supabase.co/storage/v1/object/upload/sign/aiverse-videos/${accountId}/${versionId}/${reservationId}.mp4?token=opaque.token`,
  expiresAt: new Date(Date.now() + 900000).toISOString(),
  protocol: "supabase",
  fileSize: 6,
});
const status = (state: "none" | "reserved" | "pending_review" | "failed" = "none") => ({
  accountId,
  versionId,
  reservationId: state === "none" ? null : reservationId,
  status: state,
});
let state: Store;
let props: Parameters<typeof StorageUploadForm>[0];
let storage: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
  const tree = StorageUploadForm(props);
  for (const effect of hooks.pending.splice(0)) effect();
  return elements(tree);
}
function unmount() {
  for (const effect of state.effects.values()) effect.cleanup?.();
}
async function settle() {
  for (let i = 0; i < 25; i++) {
    await Promise.resolve();
    render();
  }
}
function submit(selected: unknown = file) {
  const form = render().find((node) => node.type === "form")!;
  return (form.props.onSubmit as (event: unknown) => Promise<void>)({
    preventDefault() {},
    currentTarget: { file: selected },
  });
}
function click(label: string) {
  const button = render().find((node) => node.type === "button" && text(node) === label);
  if (!button) throw new Error(`Missing ${label}`);
  return (button.props.onClick as () => void)();
}
const posts = () => fetchMock.mock.calls.filter(([, init]) => init.method === "POST");
const journal = () => JSON.parse(storage.get(storageJournalKey(accountId, versionId))!);
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
  fetchMock = vi.fn(async (path: string, init: RequestInit) =>
    Response.json(
      init.method === "POST"
        ? path.endsWith("complete")
          ? status("pending_review")
          : grant()
        : status(),
      { status: 200 },
    ),
  );
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
  await settle();
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("actual private Storage upload form", () => {
  it("checks recovery first, persists before authorization, transfers once and requires server inspection", async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const pending = submit();
    await submit();
    expect(posts()).toHaveLength(1);
    expect(journal().phase).toBe("started");
    expect(journal().reservationId).toBeNull();
    const [, init] = posts()[0];
    expect(init.headers["X-AIVerse-Account"]).toBe(accountId);
    expect(JSON.parse(init.body)).toEqual({
      versionId,
      idempotencyKey: journal().requestKey,
      fileSize: 6,
    });
    response.resolve(Response.json(grant()));
    await pending;
    expect(hooks.transfer).toHaveBeenCalledOnce();
    expect(posts()[1][0]).toBe("/api/studio/uploads/complete");
    expect(JSON.parse(posts()[1][1].body)).toEqual({ reservationId, versionId });
    expect(journal().phase).toBe("complete");
    expect(props.onUploaded).toHaveBeenCalledOnce();
  });
  it("does not authorize disabled, oversized, non-MP4 files or a denied parent lock", async () => {
    props.enabled = false;
    await submit();
    props.enabled = true;
    await submit(new File(["sample"], "film.mov", { type: "video/quicktime" }));
    const large = new File(["x"], "film.mp4");
    vi.spyOn(large, "size", "get").mockReturnValue(50_000_001);
    await submit(large);
    props.onBusyChange = vi.fn(() => false);
    await submit();
    expect(posts()).toHaveLength(0);
    expect(storage.size).toBe(0);
    expect(render().map(text).join()).toContain("50 MB");
  });
  it("keeps 100% as transfer progress until the completion endpoint confirms inspection", async () => {
    const transfer = deferred<void>();
    const completion = deferred<Response>();
    hooks.transfer.mockReturnValueOnce(transfer.promise);
    const pending = submit();
    await settle();
    const parameters = hooks.transfer.mock.calls[0][0];
    parameters.onProgress(100);
    expect(render().find((node) => node.type === "progress")?.props.value).toBe(100);
    expect(props.onUploaded).not.toHaveBeenCalled();
    fetchMock.mockReturnValueOnce(completion.promise);
    transfer.resolve();
    await settle();
    expect(render().map(text).join()).toContain("Inspecting the uploaded file");
    expect(props.onUploaded).not.toHaveBeenCalled();
    completion.resolve(Response.json(status("pending_review")));
    await pending;
    expect(props.onUploaded).toHaveBeenCalledOnce();
  });
  it("recovers completion after cancellation without another capability or another binary transfer", async () => {
    const sent = deferred<void>();
    hooks.transfer.mockReturnValueOnce(sent.promise);
    const pending = submit();
    await settle();
    const signal = hooks.transfer.mock.calls[0][0].signal as AbortSignal;
    click("Cancel upload");
    expect(signal.aborted).toBe(true);
    sent.resolve();
    await pending;
    await submit();
    expect(posts()).toHaveLength(1);
    click("Check uploaded file");
    await settle();
    expect(posts()).toHaveLength(2);
    expect(posts()[1][0]).toBe("/api/studio/uploads/complete");
    expect(hooks.transfer).toHaveBeenCalledOnce();
    expect(props.onUploaded).toHaveBeenCalledOnce();
  });
  it("restores a reserved attempt from the server after reload without persisting its signed URL", async () => {
    unmount();
    state = { values: [], effects: new Map() };
    fetchMock.mockResolvedValueOnce(Response.json(status("reserved")));
    render();
    await settle();
    expect(journal().reservationId).toBe(reservationId);
    expect([...storage.values()].join()).not.toMatch(/token|uploadUrl|film.mp4/);
    await submit();
    expect(posts()).toHaveLength(0);
    click("Check uploaded file");
    await settle();
    expect(posts()).toHaveLength(1);
    expect(hooks.transfer).not.toHaveBeenCalled();
  });
  it.each([accountChangedEvent, accountUnavailableEvent])(
    "invalidates pending owner requests on %s and ignores late capability replies",
    async (event) => {
      const response = deferred<Response>();
      fetchMock.mockReturnValueOnce(response.promise);
      const pending = submit();
      const signal = posts()[0][1].signal as AbortSignal;
      window.dispatchEvent(new Event(event));
      expect(signal.aborted).toBe(true);
      response.resolve(Response.json(grant()));
      await pending;
      expect(hooks.transfer).not.toHaveBeenCalled();
      expect(props.onUploaded).not.toHaveBeenCalled();
      expect(render().map(text).join()).toContain("Your account changed");
    },
  );
  it.each([401, 403, 409, 503])(
    "keeps a denied HTTP %s authorization latched with safe recovery and no secret text",
    async (code) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ error: "secret transport detail" }, { status: code }),
      );
      await submit();
      await submit();
      expect(posts()).toHaveLength(1);
      expect(hooks.transfer).not.toHaveBeenCalled();
      expect(render().map(text).join()).not.toContain("secret transport detail");
      expect(journal().phase).toBe("uncertain");
      if (code === 401) expect(render().some((node) => node.props.href === "/login")).toBe(true);
    },
  );
  it("does not issue authorization when recovery storage cannot be confirmed", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem() {} });
    await submit();
    expect(posts()).toHaveLength(0);
    expect(hooks.transfer).not.toHaveBeenCalled();
  });
  it("aborts on unmount and performs no stale React update or automatic completion", async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const pending = submit();
    unmount();
    const writes = hooks.writes;
    expect(posts()[0][1].signal.aborted).toBe(true);
    response.resolve(Response.json(grant()));
    await pending;
    expect(hooks.writes).toBe(writes);
    expect(posts()).toHaveLength(1);
    expect(props.onUploaded).not.toHaveBeenCalled();
  });
});
