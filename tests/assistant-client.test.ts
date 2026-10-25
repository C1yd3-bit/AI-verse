import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoveryQuerySchema } from "../src/features/discovery/query";
import { accountUnavailableEvent } from "../src/lib/appearance";

// Drive the actual save handler with deferred network replies, without a DOM or
// a test-only copy of the save logic. Only React's hook scheduler is substituted.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  cleanups: [] as (() => void)[],
  writes: 0,
  mounted: false,
  accountId: "93000000-0000-4000-8000-000000000001" as string | null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "mix-name",
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.writes += 1;
        hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect: (effect: () => (() => void) | undefined) => {
    if (!hooks.mounted) {
      const cleanup = effect();
      if (cleanup) hooks.cleanups.push(cleanup);
    }
  },
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/image", () => ({ default: "img" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("../src/components/appearance-provider", () => ({
  useAppearance: () => ({ ready: true, accountId: hooks.accountId }),
}));
import { SavedFusion } from "../src/components/saved-fusion";
import { DiscoveryAssistant } from "../src/components/discovery-assistant";

const accountId = "93000000-0000-4000-8000-000000000001";
let mixName = "My cat mix";
let fetchMock: ReturnType<typeof vi.fn>;
function render() {
  hooks.cursor = 0;
  const tree = SavedFusion({
    query: discoveryQuerySchema.parse({ keywords: ["cat"] }),
    expectedAccountId: accountId,
  });
  hooks.mounted = true;
  return tree;
}
function form(
  node: ReactNode,
): ReactElement<{ onSubmit: (event: unknown) => Promise<void> }> | undefined {
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === "form") return element as ReturnType<typeof form>;
  for (const child of [element.props.children].flat(Infinity) as ReactNode[]) {
    const found = form(child);
    if (found) return found;
  }
}
function submit() {
  const handler = form(render())?.props.onSubmit;
  if (!handler) throw new Error("Missing real save form");
  return handler({ preventDefault() {}, currentTarget: {} });
}
beforeEach(() => {
  hooks.cursor = 0;
  hooks.values = [];
  hooks.cleanups = [];
  hooks.writes = 0;
  hooks.mounted = false;
  hooks.accountId = accountId;
  mixName = "My cat mix";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "FormData",
    class {
      get() {
        return mixName;
      }
    },
  );
  vi.stubGlobal("window", new EventTarget());
});

type ElementProps = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<ElementProps>;
  return [
    element,
    ...[element.props.children].flat(Infinity).flatMap((child) => elements(child as ReactNode)),
  ];
}
function renderAssistant() {
  hooks.cursor = 0;
  const tree = DiscoveryAssistant({ liveCatalog: false });
  hooks.mounted = true;
  return elements(tree);
}
function assistantElement(type: string) {
  const result = renderAssistant().find((node) => node.type === type);
  if (!result) throw new Error(`Missing ${type}`);
  return result;
}
async function ask(message: string) {
  (assistantElement("textarea").props.onChange as (event: unknown) => void)({
    target: { value: message },
  });
  (assistantElement("form").props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  await vi.waitFor(() => expect(assistantElement("textarea").props.value).toBe(""));
}
function emptyResponse() {
  return new Response(
    JSON.stringify({
      mode: "demo",
      query: discoveryQuerySchema.parse({}),
      reply: "No exact catalog matches.",
      filters: [],
      exact: { total: 0, items: [] },
      broader: { label: "Broader suggestions", items: [] },
      fusionUrl: "/fusion",
      searchUrl: "/search",
    }),
    { status: 200 },
  );
}

describe("assistant session lifecycle", () => {
  it("gives the ninth reply a fresh save form after the eight-turn memory cap", async () => {
    fetchMock.mockImplementation(async () => emptyResponse());
    const keys: (string | null)[] = [];
    for (let index = 0; index < 9; index += 1) {
      await ask(`request ${index}`);
      const nodes = renderAssistant();
      const save = nodes.find((node) => node.type === SavedFusion);
      expect(save).toBeDefined();
      keys.push(save!.key);
      const history = nodes.filter((node) => node.props.className === "assistant-turn");
      expect(history.length).toBe(Math.min(index + 1, 8));
    }
    expect(new Set(keys).size).toBe(9);
  });

  it("clears signed-in conversation and draft on confirmed account loss, then ignores guest repeats", async () => {
    fetchMock.mockImplementation(async () => emptyResponse());
    await ask("private viewing request");
    (assistantElement("textarea").props.onChange as (event: unknown) => void)({
      target: { value: "unsent viewing request" },
    });
    expect(assistantElement("textarea").props.value).toBe("unsent viewing request");
    window.dispatchEvent(new Event(accountUnavailableEvent));
    expect(assistantElement("textarea").props.value).toBe("");
    expect(
      renderAssistant().filter((node) => node.props.className === "assistant-turn"),
    ).toHaveLength(0);
    const writesBeforeRepeat = hooks.writes;
    window.dispatchEvent(new Event(accountUnavailableEvent));
    expect(hooks.writes).toBe(writesBeforeRepeat);
  });
});
afterEach(() => {
  hooks.cleanups.forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

describe("assistant's account-bound saved Fusion", () => {
  it("validates names and sends the existing body with a comparison identity", async () => {
    mixName = " ";
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hooks.values[3]).toContain("Give this mix a name");
    mixName = "My cat mix";
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await submit();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/me/library");
    expect(init.headers["X-AIVerse-Account"]).toBe(accountId);
    expect(JSON.parse(init.body)).toEqual({
      action: "save_fusion",
      id: null,
      name: mixName,
      query: discoveryQuerySchema.parse({ keywords: ["cat"] }),
    });
    expect(hooks.values[2]).toBe("Mix saved to your account library.");
  });

  it("keeps a denied save recoverable and permits a successful retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 409 }));
    await submit();
    expect(hooks.values[2]).toBe("");
    expect(hooks.values[3]).toContain("Your account changed");
    expect(hooks.values[0]).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await submit();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hooks.values[2]).toBe("Mix saved to your account library.");
    expect(hooks.values[3]).toBe("");
  });

  it("prevents duplicate saves and ignores a late reply after unmount", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const pending = submit();
    await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    hooks.cleanups.forEach((cleanup) => cleanup());
    expect(signal.aborted).toBe(true);
    const writesBeforeReply = hooks.writes;
    resolve(new Response("{}", { status: 200 }));
    await pending;
    expect(hooks.writes).toBe(writesBeforeReply);
    expect(hooks.values[2]).toBe("");
  });
});
