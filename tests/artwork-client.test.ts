import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountChangedEvent } from "../src/lib/appearance";
type Store = { values: unknown[]; effects: Map<number, { deps: unknown[]; cleanup?: () => void }> };
const hooks = vi.hoisted(() => ({
  cursor: 0,
  store: null as Store | null,
  pending: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "artwork-feedback",
  useState(initial: unknown) {
    const index = hooks.cursor++;
    const store = hooks.store!;
    if (!(index in store.values)) store.values[index] = initial;
    return [
      store.values[index],
      (value: unknown) => {
        store.values[index] = typeof value === "function" ? value(store.values[index]) : value;
      },
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    const store = hooks.store!;
    if (!(index in store.values)) store.values[index] = { current: initial };
    return store.values[index];
  },
  useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
    const index = hooks.cursor++;
    const store = hooks.store!;
    const earlier = store.effects.get(index);
    if (
      earlier &&
      deps.length === earlier.deps.length &&
      deps.every((value, offset) => Object.is(value, earlier.deps[offset]))
    )
      return;
    hooks.pending.push(() => {
      earlier?.cleanup?.();
      store.effects.set(index, { deps, cleanup: effect() });
    });
  },
}));
import { VersionArtwork, VersionArtworkPreview } from "../src/components/version-artwork";
type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const accountId = "a6000000-0000-4000-8000-000000000001";
const versionId = "a6000000-0000-4000-8000-000000000002";
const image = "data:image/webp;base64,UklGRgAAAABXRUJQ";
const reply = (photo: string | null = null, account = accountId, revision = versionId) =>
  Response.json({ accountId: account, versionId: revision, image: photo });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let store: Store;
let fetchMock: ReturnType<typeof vi.fn>;
let events: EventTarget;
let nodes: Node[];
let enabled: boolean;
let claim: ReturnType<typeof vi.fn<(busy: boolean) => boolean | void>>;
let readonly: boolean;
let readiness: ReturnType<typeof vi.fn<(ready: boolean) => void>>;
function elements(node: ReactNode): Node[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const item = node as Node;
  return [
    item,
    ...[item.props.children].flat(Infinity).flatMap((child) => elements(child as ReactNode)),
  ];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return [(node as Node).props.children]
    .flat(Infinity)
    .map((child) => text(child as ReactNode))
    .join("");
}
function render() {
  hooks.cursor = 0;
  hooks.store = store;
  const wrapper = readonly
    ? VersionArtworkPreview({ accountId, versionId, enabled, onReadyChange: readiness })
    : VersionArtwork({ accountId, versionId, enabled, onBusyChange: claim });
  const node = (wrapper.type as (props: unknown) => ReactNode)(wrapper.props);
  nodes = elements(node);
  for (const run of hooks.pending.splice(0)) run();
  return text(node);
}
async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
  render();
}
function select(file = new File(["bytes"], "thumbnail.png", { type: "image/png" })) {
  const input = nodes.find((node) => node.type === "input")!;
  (input.props.onChange as (event: unknown) => void)({
    currentTarget: { files: [file], value: file.name },
  });
  render();
}
function save() {
  return (
    nodes.find((node) => node.type === "form")!.props.onSubmit as (event: unknown) => Promise<void>
  )({ preventDefault() {} });
}
beforeEach(() => {
  store = { values: [], effects: new Map() };
  hooks.pending = [];
  hooks.cursor = 0;
  events = new EventTarget();
  vi.stubGlobal("window", events);
  fetchMock = vi.fn().mockResolvedValue(reply());
  vi.stubGlobal("fetch", fetchMock);
  enabled = true;
  claim = vi.fn().mockReturnValue(true);
  readonly = false;
  readiness = vi.fn();
});
afterEach(() => {
  for (const effect of store.effects.values()) effect.cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("actual optional revision thumbnail component handlers", () => {
  it("readonly review loads exact private thumbnail or confirmed absence without save/file controls", async () => {
    readonly = true;
    fetchMock.mockResolvedValueOnce(reply(image));
    render();
    await settle();
    expect(nodes.some((node) => node.type === "input" || node.type === "form")).toBe(false);
    expect(nodes.some((node) => node.type === "button" && text(node).includes("Save"))).toBe(false);
    expect(nodes.find((node) => node.type === "img")?.props.src).toBe(image);
    expect(readiness).toHaveBeenLastCalledWith(false);
    (nodes.find((node) => node.type === "img")!.props.onLoad as () => void)();
    expect(readiness).toHaveBeenLastCalledWith(true);
    expect(claim).not.toHaveBeenCalled();
  });
  it("readonly image decode failure blocks readiness and stale native load cannot re-enable after identity loss", async () => {
    readonly = true;
    fetchMock.mockResolvedValueOnce(reply(image));
    render();
    await settle();
    const originalImage = nodes.find((node) => node.type === "img")!;
    (originalImage.props.onError as () => void)();
    expect(readiness).toHaveBeenLastCalledWith(false);
    expect(render()).toContain("Thumbnail could not display");
    (originalImage.props.onLoad as () => void)();
    expect(readiness).toHaveBeenLastCalledWith(false);
    fetchMock.mockResolvedValueOnce(reply(image));
    (
      nodes.find((node) => node.type === "button" && text(node) === "Reload thumbnail")!.props
        .onClick as () => void
    )();
    await settle();
    const retryImage = nodes.find((node) => node.type === "img")!;
    events.dispatchEvent(new Event(accountChangedEvent));
    (retryImage.props.onLoad as () => void)();
    expect(readiness).toHaveBeenLastCalledWith(false);
  });
  it("readonly failed preview reports not-ready and real retry confirms nullable absence", async () => {
    readonly = true;
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 502 }));
    render();
    await settle();
    expect(readiness).toHaveBeenLastCalledWith(false);
    fetchMock.mockResolvedValueOnce(reply(null));
    const reload = nodes.find(
      (node) => node.type === "button" && text(node) === "Reload thumbnail",
    )!;
    (reload.props.onClick as () => void)();
    await settle();
    expect(readiness).toHaveBeenLastCalledWith(true);
    expect(render()).toContain("No thumbnail saved for this revision");
    expect(nodes.some((node) => node.type === "input" || node.type === "form")).toBe(false);
    events.dispatchEvent(new Event(accountChangedEvent));
    expect(readiness).toHaveBeenLastCalledWith(false);
  });
  it("loads only the exact private revision, preserves nullable state and retries a failed GET explicitly", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 502 }));
    render();
    await settle();
    expect(render()).toContain("Reload thumbnail");
    fetchMock.mockResolvedValueOnce(reply(image));
    const reload = nodes.find(
      (node) => node.type === "button" && text(node) === "Reload thumbnail",
    )!;
    (reload.props.onClick as () => void)();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/studio/versions/${versionId}/artwork`);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "X-AIVerse-Account": accountId });
    expect(nodes.find((node) => node.type === "img")?.props.src).toBe(image);
  });
  it("rejects bad file type empty and oversized bytes without POST", async () => {
    render();
    await settle();
    for (const file of [
      new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }),
      new File([], "empty.png", { type: "image/png" }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }),
    ]) {
      select(file);
      await save();
      expect(render()).toContain("Choose a still JPEG");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("acquires shared claim before POST and serializes duplicate submits, retaining work through own disabled prop", async () => {
    render();
    await settle();
    select();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const first = save();
    const second = save();
    await second;
    enabled = false;
    render();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledExactlyOnceWith(true);
    pending.resolve(reply(image));
    await first;
    expect(render()).toContain("Thumbnail saved for this revision");
    expect(claim).toHaveBeenLastCalledWith(false);
  });
  it("does not issue POST when another draft action owns shared claim", async () => {
    render();
    await settle();
    select();
    claim.mockReturnValue(false);
    await save();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("ignores late private reads after save, and validates reply owner/revision before displaying", async () => {
    const earlier = deferred<Response>();
    fetchMock.mockReturnValueOnce(earlier.promise);
    render();
    await Promise.resolve();
    select();
    fetchMock.mockResolvedValueOnce(reply(image));
    await save();
    earlier.resolve(reply(null));
    await settle();
    expect(nodes.find((node) => node.type === "img")?.props.src).toBe(image);
    select();
    fetchMock.mockResolvedValueOnce(reply(image, "a6000000-0000-4000-8000-000000000099"));
    await save();
    expect(render()).toContain("Account or film revision changed");
  });
  it("aborts pending save and clears private state on identity loss; late reply cannot return imagery", async () => {
    render();
    await settle();
    select();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const saving = save();
    const signal = fetchMock.mock.calls[1][1].signal;
    events.dispatchEvent(new Event(accountChangedEvent));
    expect(signal.aborted).toBe(true);
    pending.resolve(reply(image));
    await saving;
    expect(render()).toContain("Your account changed");
    expect(nodes.some((node) => node.type === "img")).toBe(false);
    expect(nodes.find((node) => node.type === "input")?.props.disabled).toBe(true);
  });
  it("redacts backend errors and keeps recovery usable after a failed save", async () => {
    render();
    await settle();
    select();
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "secret signed upload token" }, { status: 409 }),
    );
    await save();
    expect(render()).toContain("Your access or draft changed");
    expect(render()).not.toContain("secret");
    expect(render()).toContain("Reload thumbnail");
  });
  it("aborts pending work on unmount and suppresses late successful replies", async () => {
    render();
    await settle();
    select();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const saving = save();
    const signal = fetchMock.mock.calls[1][1].signal;
    for (const effect of store.effects.values()) effect.cleanup?.();
    const before = store.values.slice();
    pending.resolve(reply(image));
    await saving;
    expect(signal.aborted).toBe(true);
    expect(store.values).toEqual(before);
    expect(claim).toHaveBeenLastCalledWith(false);
  });
});
