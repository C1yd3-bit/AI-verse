import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountChangedEvent, accountUnavailableEvent } from "../src/lib/appearance";

type Store = { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }> };
const hooks = vi.hoisted(() => ({
  cursor: 0,
  state: null as Store | null,
  pending: [] as (() => void)[],
  writes: 0,
  accountId: "97000000-0000-4000-8000-000000000001" as string | null,
  ready: true,
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
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../src/components/appearance-provider", () => ({
  useAppearance: () => ({ accountId: hooks.accountId, ready: hooks.ready }),
}));
vi.mock("../src/components/film-player", () => ({ FilmPlayer: "film-player" }));
vi.mock("../src/components/version-artwork", () => ({ VersionArtwork: "version-artwork" }));
vi.mock("../src/components/studio-upload-form", () => ({ StudioUploadForm: "video-upload" }));
import { StudioPanel } from "../src/components/studio-panel";
type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const accountId = "97000000-0000-4000-8000-000000000001";
const versionId = "97000000-0000-4000-8000-000000000002";
const videoId = "97000000-0000-4000-8000-000000000003";
const applicationId = "97000000-0000-4000-8000-000000000004";
const version = {
  id: versionId,
  video_id: videoId,
  revision: 1,
  state: "draft",
  duration_seconds: null,
  created_at: "2026-10-25T00:00:00Z",
  metadata: {
    title: "Private fixture",
    description: "A rights-cleared test metadata record.",
    format: "reel",
    genres: ["romance"],
    regions: ["korean"],
    languages: ["english"],
    tags: [],
    ai_disclosed: true,
    rights_attested: true,
    rights_declaration: "All materials are original for this isolated test.",
  },
};
let eligible: boolean;
let wrapperState: Store;
let state: Store;
let key: string | null;
let fetchMock: ReturnType<typeof vi.fn>;
let configured: boolean;
let uploadsEnabled: boolean;
let reset: ReturnType<typeof vi.fn>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
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
function invoke(component: (props: never) => ReactNode, props: unknown, store: Store) {
  hooks.cursor = 0;
  hooks.state = store;
  const result = component(props as never);
  for (const effect of hooks.pending.splice(0)) effect();
  return result;
}
function unmount(store = state) {
  for (const effect of store.effects.values()) effect.cleanup?.();
}
function render() {
  invoke(StudioPanel as (props: never) => ReactNode, { configured, uploadsEnabled }, wrapperState);
  const child = invoke(
    StudioPanel as (props: never) => ReactNode,
    { configured, uploadsEnabled },
    wrapperState,
  ) as Node;
  if (key !== child.key) {
    unmount();
    state = { values: [], effects: new Map() };
    key = child.key;
  }
  return elements(invoke(child.type as (props: never) => ReactNode, child.props, state));
}
async function settle() {
  for (let index = 0; index < 25; index++) {
    await Promise.resolve();
    render();
  }
}
function refresh() {
  const button = render().find(
    (node) => node.type === "button" && typeof node.props.onClick === "function",
  )!;
  return (button.props.onClick as () => void)();
}
function draftEvent() {
  return {
    preventDefault() {},
    currentTarget: {
      videoId: "",
      title: "A new film",
      description: "An original test film.",
      format: "reel",
      genres: ["romance"],
      regions: ["korean"],
      languages: ["english"],
      tags: "original",
      ai_disclosed: "on",
      rights_attested: "on",
      rights_declaration: "Original materials and no third-party content.",
      reset,
    },
  };
}
function submit() {
  const nodes = render();
  const form = nodes.find(
    (node) => node.type === "form" && node.props.className === "studio-form",
  )!;
  return (form.props.onSubmit as (event: unknown) => Promise<void>)(draftEvent());
}
function transfers() {
  return render().filter((node) => node.type === "version-artwork" || node.type === "video-upload");
}
function postCalls() {
  return fetchMock.mock.calls.filter(([, init]) => init.method === "POST");
}
beforeEach(async () => {
  wrapperState = { values: [], effects: new Map() };
  state = { values: [], effects: new Map() };
  key = null;
  hooks.pending = [];
  hooks.writes = 0;
  hooks.accountId = accountId;
  hooks.ready = true;
  eligible = true;
  configured = true;
  uploadsEnabled = true;
  reset = vi.fn();
  fetchMock = vi.fn(async (path: string, init: RequestInit) => {
    if (init.method === "POST")
      return Response.json(
        path.endsWith("versions")
          ? { version: { video_id: videoId, version_id: versionId } }
          : { applicationId },
        { status: 201 },
      );
    return Response.json(
      path === "/api/studio"
        ? {
            eligible,
            videos: [
              {
                id: videoId,
                state: "draft",
                latest_version_id: versionId,
                active_version_id: null,
              },
            ],
            versions: [version],
          }
        : { applications: [] },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "FormData",
    class {
      constructor(private fields: Record<string, unknown>) {}
      get(name: string) {
        return this.fields[name] ?? null;
      }
      getAll(name: string) {
        const value = this.fields[name];
        return Array.isArray(value) ? value : value === undefined ? [] : [value];
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
describe("actual private Studio request ownership", () => {
  it.each([401, 403, 409])(
    "clears private records on HTTP %s without an identity event and permits explicit recovery",
    async (status) => {
      fetchMock.mockResolvedValueOnce(Response.json({ error: "Access changed" }, { status }));
      refresh();
      await settle();
      expect(render().map(text).join()).not.toContain("Private fixture");
      expect(transfers()).toHaveLength(0);
      refresh();
      await settle();
      expect(transfers()).toHaveLength(2);
    },
  );
  it("clears private state on a denied mutation and releases the request lock for explicit recovery", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Account changed" }, { status: 409 }));
    await submit();
    expect(transfers()).toHaveLength(0);
    expect(reset).not.toHaveBeenCalled();
    refresh();
    await settle();
    expect(transfers()).toHaveLength(2);
  });
  it("uses one owner-compared Studio read without an application dependency and shows direct draft tools", () => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/studio");
    for (const [, init] of fetchMock.mock.calls)
      expect(init.headers["X-AIVerse-Account"]).toBe(accountId);
    expect(transfers()).toHaveLength(2);
    expect(render().some((node) => node.props.href === "/login")).toBe(false);
  });
  it("does not fetch for an unconfigured or guest studio", async () => {
    configured = false;
    render();
    await settle();
    const calls = fetchMock.mock.calls.length;
    hooks.accountId = null;
    render();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(transfers()).toHaveLength(0);
  });
  it.each([accountChangedEvent, accountUnavailableEvent])(
    "keeps a guest studio in its normal sign-in state after %s",
    async (event) => {
      hooks.accountId = null;
      render();
      await settle();
      fetchMock.mockClear();
      const writes = hooks.writes;
      window.dispatchEvent(new Event(event));
      await settle();
      const nodes = render();
      expect(hooks.writes).toBe(writes);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(nodes.map(text).join()).toContain("Sign in to prepare your videos");
      expect(nodes.map(text).join()).not.toContain("Your account changed");
      expect(nodes.some((node) => node.props.role === "alert")).toBe(false);
      expect(nodes.some((node) => node.props.href === "/login")).toBe(true);
      expect(transfers()).toHaveLength(0);
    },
  );
  it("serializes duplicate mutation and refresh requests, then keeps the lock until reread completes", async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const first = submit();
    await submit();
    refresh();
    expect(postCalls()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    response.resolve(
      Response.json({ version: { video_id: videoId, version_id: versionId } }, { status: 201 }),
    );
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(reset).toHaveBeenCalledOnce();
    expect(render().map(text).join()).toContain("saved privately");
  });
  it("preserves uncertain mutation input and requires explicit refresh before another mutation", async () => {
    fetchMock.mockRejectedValueOnce(new Error("private transport detail"));
    await submit();
    await submit();
    expect(postCalls()).toHaveLength(1);
    expect(reset).not.toHaveBeenCalled();
    expect(render().map(text).join()).toContain("input is kept");
    refresh();
    await settle();
    await submit();
    expect(postCalls()).toHaveLength(2);
  });
  it("refuses an old rendered submit handler immediately after an uncertain mutation, before rerender", async () => {
    const form = render().find(
      (node) => node.type === "form" && node.props.className === "studio-form",
    )!;
    const handler = form.props.onSubmit as (event: unknown) => Promise<void>;
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await handler(draftEvent());
    await handler(draftEvent());
    expect(postCalls()).toHaveLength(1);
  });
  it("keeps a confirmed save honest if refresh fails, with no automatic second write", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ version: { video_id: videoId, version_id: versionId } }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    await submit();
    await submit();
    expect(postCalls()).toHaveLength(1);
    expect(reset).toHaveBeenCalledOnce();
    expect(render().map(text).join()).toContain("Your change was saved");
  });
  it.each([accountChangedEvent, accountUnavailableEvent])(
    "clears private records on %s and ignores a delayed mutation response",
    async (event) => {
      const response = deferred<Response>();
      fetchMock.mockReturnValueOnce(response.promise);
      const pending = submit();
      const signal = postCalls()[0][1].signal as AbortSignal;
      window.dispatchEvent(new Event(event));
      expect(signal.aborted).toBe(true);
      response.resolve(Response.json({ version: { video_id: videoId, version_id: versionId } }));
      await pending;
      expect(render().map(text).join()).not.toContain("Private fixture");
      expect(reset).not.toHaveBeenCalled();
      expect(transfers()).toHaveLength(0);
    },
  );
  it("preserves the same account session across temporary appearance refresh and clears it when a new identity is confirmed", async () => {
    const previous = key;
    const requests = fetchMock.mock.calls.length;
    hooks.ready = false;
    hooks.accountId = null;
    render();
    await settle();
    expect(key).toBe(previous);
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    expect(transfers()).toHaveLength(2);
    hooks.ready = true;
    hooks.accountId = applicationId;
    render();
    expect(key).not.toBe(previous);
    expect(transfers()).toHaveLength(0);
  });
  it("claims exactly one upload/artwork operation synchronously; an old release cannot unlock another owner", async () => {
    const [artwork, upload] = transfers();
    const artBusy = artwork.props.onBusyChange as (busy: boolean) => boolean;
    const uploadBusy = upload.props.onBusyChange as (busy: boolean) => boolean;
    expect(artBusy(true)).toBe(true);
    expect(uploadBusy(true)).toBe(false);
    refresh();
    await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    uploadBusy(false);
    expect(uploadBusy(true)).toBe(false);
    artBusy(false);
    expect(uploadBusy(true)).toBe(true);
    artBusy(false);
    expect(artBusy(true)).toBe(false);
    uploadBusy(false);
    refresh();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("prevents a transfer claim while a draft mutation is pending", async () => {
    const busy = transfers()[0].props.onBusyChange as (busy: boolean) => boolean;
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const pending = submit();
    expect(busy(true)).toBe(false);
    response.resolve(Response.json({ version: { video_id: videoId, version_id: versionId } }));
    await pending;
  });
  it("aborts private reads on unmount and ignores their late records", async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    refresh();
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    unmount();
    const writes = hooks.writes;
    expect(signal.aborted).toBe(true);
    response.resolve(Response.json({ eligible, videos: [], versions: [] }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(hooks.writes).toBe(writes);
  });
  it("lets an eligible viewer save directly without an application or creator role", async () => {
    expect(render().map(text).join()).not.toContain("Apply to create");
    await submit();
    expect(postCalls()).toHaveLength(1);
    expect(postCalls()[0][0]).toBe("/api/studio/versions");
    expect(postCalls()[0][1].headers["X-AIVerse-Account"]).toBe(accountId);
    expect(render().map(text).join()).toContain("saved privately");
    expect(fetchMock.mock.calls.some(([path]) => path.includes("applications"))).toBe(false);
  });
  it("preserves owned history but disables mutations when upload access is suspended", async () => {
    eligible = false;
    refresh();
    await settle();
    expect(render().map(text).join()).toContain("Upload access is suspended");
    expect(render().map(text).join()).toContain("Private fixture");
    expect(transfers().every((node) => node.props.enabled === false)).toBe(true);
    await submit();
    expect(postCalls()).toHaveLength(0);
  });
  it("keeps private draft preparation available while truthfully disabling an unconfigured video transfer", async () => {
    uploadsEnabled = false;
    const nodes = render();
    expect(nodes.map(text).join()).toContain("video service is not configured");
    const upload = transfers().find((node) => node.type === "video-upload")!;
    expect(upload.props.providerEnabled).toBe(false);
    expect(upload.props.enabled).toBe(false);
    await submit();
    expect(postCalls()).toHaveLength(1);
    expect(reset).toHaveBeenCalledOnce();
  });
  it.each([401, 403])(
    "explains a known HTTP %s denial without uncertain-save messaging or clearing draft input",
    async (status) => {
      fetchMock.mockResolvedValueOnce(Response.json({ error: "Denied" }, { status }));
      await submit();
      const copy = render().map(text).join();
      expect(copy).toContain(status === 401 ? "Your session expired" : "This request was denied");
      expect(copy).not.toContain("change could not be confirmed");
      expect(render().some((node) => node.props.href === "/login")).toBe(true);
      expect(reset).not.toHaveBeenCalled();
      expect(render().some((node) => node.type === "form")).toBe(true);
      expect(transfers()).toHaveLength(0);
      refresh();
      await settle();
      expect(transfers()).toHaveLength(2);
      expect(render().some((node) => node.props.href === "/login")).toBe(false);
    },
  );
});
