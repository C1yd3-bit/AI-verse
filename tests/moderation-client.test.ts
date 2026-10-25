import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountChangedEvent, accountUnavailableEvent } from "../src/lib/appearance";

type Store = {
  values: unknown[];
  effects: Map<number, { deps: unknown[]; cleanup?: () => void }>;
};
// The actual component handlers run unchanged. Only React scheduling and native
// FormData are substituted, to drive races without a simulated copy of the UI.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  store: null as Store | null,
  pending: [] as (() => void)[],
  accountId: "95000000-0000-4000-8000-000000000001" as string | null,
  writes: 0,
  ready: true,
  artworkReady: true,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "decision-feedback",
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    const store = hooks.store!;
    if (!(index in store.values)) store.values[index] = initial;
    return [
      store.values[index],
      (value: unknown) => {
        hooks.writes += 1;
        store.values[index] = typeof value === "function" ? value(store.values[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    const store = hooks.store!;
    if (!(index in store.values)) store.values[index] = { current: initial };
    return store.values[index];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.cursor++;
    const store = hooks.store!;
    const previous = store.effects.get(index);
    if (
      previous &&
      deps.length === previous.deps.length &&
      deps.every((value, offset) => Object.is(value, previous.deps[offset]))
    )
      return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      store.effects.set(index, { deps, cleanup: effect() });
    });
  },
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../src/components/film-player", () => ({ FilmPlayer: "film-player" }));
vi.mock("../src/components/version-artwork", () => ({ VersionArtworkPreview: "artwork-preview" }));
vi.mock("../src/components/appearance-provider", () => ({
  useAppearance: () => ({ accountId: hooks.accountId, ready: hooks.ready }),
}));
import { ModerationPanel } from "../src/components/moderation-panel";

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const accountId = "95000000-0000-4000-8000-000000000001";
const versionId = "95000000-0000-4000-8000-000000000002";
const videoId = "95000000-0000-4000-8000-000000000003";
const applicationId = "95000000-0000-4000-8000-000000000004";
const version = {
  id: versionId,
  video_id: videoId,
  revision: 1,
  state: "pending_review",
  duration_seconds: 90,
  metadata: {
    title: "Review fixture",
    description: "A local test submission",
    format: "reel",
    genres: ["romance"],
    regions: ["korean"],
    languages: ["english"],
    tags: [],
    ai_disclosed: true,
    rights_attested: true,
    rights_declaration: "Original rights-cleared synthetic test metadata.",
  },
};
const application = {
  id: applicationId,
  user_id: accountId,
  status: "pending",
  application: {
    display_name: "Test Applicant",
    handle: "test-applicant",
    bio: "Local fixture",
    portfolio_url: "https://example.test/portfolio",
  },
};
function queue(overrides: Record<string, unknown> = {}) {
  return { roles: ["moderator"], versions: [version], applications: [], ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function store(): Store {
  return { values: [], effects: new Map() };
}
let session: Store;
let wrapperState: Store;
let forms: Map<string, Store>;
let fetchMock: ReturnType<typeof vi.fn>;
let configured: boolean;
let focus: ReturnType<typeof vi.fn>;
let nodes: Node[];
let artworkAcknowledgments: Map<string, boolean>;
let frames: (() => void)[];
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
function invoke(component: (props: never) => ReactNode, props: unknown, state: Store) {
  hooks.cursor = 0;
  hooks.store = state;
  const result = component(props as never);
  for (const effect of hooks.pending.splice(0)) effect();
  return result;
}
function wrapper() {
  // React retries a render when a newly confirmed identity adjusts this state.
  invoke(ModerationPanel as (props: never) => ReactNode, { configured }, wrapperState);
  return invoke(
    ModerationPanel as (props: never) => ReactNode,
    { configured },
    wrapperState,
  ) as ReactElement<Parameters<typeof ModerationPanel>[0]>;
}
function render() {
  const component = wrapper();
  nodes = elements(invoke(component.type as (props: never) => ReactNode, component.props, session));
  // Child rendering is controlled here; the real preview fetch/identity/retry
  // handlers are exercised independently in artwork-client.test.ts.
  let acknowledged = false;
  for (const node of nodes.filter((node) => node.type === "artwork-preview")) {
    const id = String(node.props.versionId);
    if (artworkAcknowledgments.get(id) === hooks.artworkReady) continue;
    artworkAcknowledgments.set(id, hooks.artworkReady);
    (node.props.onReadyChange as (ready: boolean) => void)(hooks.artworkReady);
    acknowledged = true;
  }
  if (acknowledged)
    nodes = elements(
      invoke(component.type as (props: never) => ReactNode, component.props, session),
    );
  const refresh = nodes.find(
    (node) => node.type === "button" && typeof node.props.onClick === "function",
  );
  if (refresh?.props.ref) (refresh.props.ref as { current: unknown }).current = { focus };
  // Apply reconciliation cleanup when a successful decision removes its form.
  for (const [key, state] of forms) {
    if (
      !nodes.some(
        (node) =>
          typeof node.type === "function" && String(node.props.id ?? node.props.kind) === key,
      )
    ) {
      unmount(state);
      forms.delete(key);
    }
  }
  return nodes;
}
function form(kind = "version") {
  render();
  const component = nodes.find(
    (node) => typeof node.type === "function" && node.props.kind === kind,
  );
  if (!component) throw new Error(`Missing ${kind} decision form`);
  const key = String(component.props.id ?? component.props.kind);
  let state = forms.get(key);
  if (!state) {
    state = store();
    forms.set(key, state);
  }
  return elements(invoke(component.type as (props: never) => ReactNode, component.props, state));
}
async function submit(fields: Record<string, string> = {}, kind = "version") {
  const formNode = form(kind).find((node) => node.type === "form")!;
  return (formNode.props.onSubmit as (event: unknown) => Promise<void>)({
    preventDefault() {},
    currentTarget: {
      decision: "reject",
      reason: "Please correct the disclosure.",
      id: videoId,
      ...fields,
    },
  });
}
function refresh() {
  const button = render().find(
    (node) => node.type === "button" && typeof node.props.onClick === "function",
  )!;
  return (button.props.onClick as () => Promise<void> | void)();
}
async function settle() {
  for (let index = 0; index < 15; index++) {
    await Promise.resolve();
    render();
  }
}
function unmount(state = session) {
  for (const effect of state.effects.values()) effect.cleanup?.();
}
function requests(method: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);
}
function runFrames() {
  for (const frame of frames.splice(0)) frame();
}
beforeEach(() => {
  session = store();
  wrapperState = store();
  forms = new Map();
  artworkAcknowledgments = new Map();
  hooks.artworkReady = true;
  configured = true;
  nodes = [];
  frames = [];
  focus = vi.fn();
  hooks.accountId = accountId;
  hooks.ready = true;
  hooks.writes = 0;
  hooks.pending = [];
  fetchMock = vi.fn(async (_input, init) =>
    init?.method === "POST" ? Response.json({ ok: true }) : Response.json(queue()),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      requestAnimationFrame: (callback: () => void) => {
        frames.push(callback);
        return frames.length;
      },
    }),
  );
  vi.stubGlobal(
    "FormData",
    class {
      constructor(private fields: Record<string, string>) {}
      get(name: string) {
        return this.fields[name] ?? null;
      }
    },
  );
});
afterEach(() => {
  unmount();
  for (const state of forms.values()) unmount(state);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("actual moderator queue lifecycle and recovery", () => {
  it("keeps revision decisions disabled until exact private thumbnail or absence is confirmed", async () => {
    hooks.artworkReady = false;
    render();
    await settle();
    expect(
      form()
        .filter((node) => node.type === "button")
        .every((node) => node.props.disabled === true),
    ).toBe(true);
    await submit({ reason: "Rights and thumbnail reviewed", decision: "approve" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/decisions"))).toBe(false);
    hooks.artworkReady = true;
    render();
    expect(
      form()
        .filter((node) => node.type === "button")
        .some((node) => node.props.disabled !== true),
    ).toBe(true);
  });
  it("does not fetch or expose sample private submissions when services are unavailable", async () => {
    configured = false;
    render();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nodes.map(text).join(" ")).not.toContain("Review fixture");
    expect(nodes.filter((node) => typeof node.type === "function")).toHaveLength(0);
    expect(nodes.map(text).join(" ")).toContain("Account services are not configured");
  });
  it("shows loading, valid moderator-only review controls, and no creator approval controls", async () => {
    const read = deferred<Response>();
    fetchMock.mockReturnValueOnce(read.promise);
    render();
    expect(nodes[0].props["aria-busy"]).toBe(true);
    expect(nodes.some((node) => node.props.role === "status")).toBe(true);
    read.resolve(Response.json(queue()));
    await settle();
    expect(nodes[0].props["aria-busy"]).toBe(false);
    expect(nodes.some((node) => node.props.kind === "version")).toBe(true);
    expect(nodes.some((node) => node.props.kind === "application")).toBe(false);
    expect(requests("GET")[0][1].headers).toEqual({ "X-AIVerse-Account": accountId });
  });
  it("reveals creator decisions only to the returned admin role and rejects unsafe portfolio links", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        queue({
          roles: ["admin"],
          applications: [
            {
              ...application,
              application: { ...application.application, portfolio_url: "javascript:alert(1)" },
            },
          ],
        }),
      ),
    );
    render();
    await settle();
    expect(nodes.some((node) => node.props.kind === "application")).toBe(true);
    expect(nodes.some((node) => node.props.href === "javascript:alert(1)")).toBe(false);
    expect(nodes.map(text).join(" ")).toContain("Portfolio link is unavailable");
  });
  it("provides a real empty queue rather than sample rows", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(queue({ versions: [] })));
    render();
    await settle();
    expect(nodes.map(text).join(" ")).toContain("No films are awaiting review");
    expect(nodes.some((node) => node.props.kind === "version")).toBe(false);
  });
  it.each([
    new Response("not json", { status: 502 }),
    Response.json({ error: "private failure" }, { status: 403 }),
  ])("recovers from unreadable/error initial responses through Refresh", async (failure) => {
    fetchMock.mockResolvedValueOnce(failure);
    render();
    await settle();
    expect(nodes.some((node) => node.props.role === "alert")).toBe(true);
    refresh();
    await settle();
    expect(nodes.some((node) => node.props.kind === "version")).toBe(true);
    expect(nodes.some((node) => node.props.role === "alert")).toBe(false);
  });
  it("warns about malformed rows while retaining valid reviews", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(queue({ versions: [version, { id: "broken" }] })),
    );
    render();
    await settle();
    expect(nodes.map(text).join(" ")).toContain("Some submissions could not be displayed");
    expect(nodes.filter((node) => node.props.kind === "version")).toHaveLength(1);
  });
  it("locks all decisions during refresh and serializes rapid refresh attempts", async () => {
    render();
    await settle();
    const read = deferred<Response>();
    fetchMock.mockReturnValueOnce(read.promise);
    refresh();
    refresh();
    expect(requests("GET")).toHaveLength(2);
    expect(form().find((node) => node.type === "fieldset")?.props.disabled).toBe(true);
    await submit();
    expect(requests("POST")).toHaveLength(0);
    read.resolve(Response.json(queue()));
    await settle();
    expect(form().find((node) => node.type === "fieldset")?.props.disabled).toBe(false);
  });
  it("drops stale private rows when refresh fails, then retries to a current queue", async () => {
    render();
    await settle();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    refresh();
    await settle();
    expect(nodes.some((node) => node.props.kind === "version")).toBe(false);
    expect(nodes.some((node) => node.props.role === "alert")).toBe(true);
    refresh();
    await settle();
    expect(nodes.some((node) => node.props.kind === "version")).toBe(true);
  });
  it("does not render privileged controls before the private identity is known", async () => {
    hooks.accountId = null;
    render();
    await settle();
    expect(nodes.some((node) => node.props.kind === "version")).toBe(false);
    expect(nodes.map(text).join(" ")).toContain("Sign in with moderator access");
    const guestKey = wrapper().key;
    hooks.accountId = accountId;
    expect(wrapper().key).not.toBe(guestKey);
  });
  it("preserves the confirmed owner, current reason form and pending decision through a transient identity refresh", async () => {
    render();
    await settle();
    const originalKey = wrapper().key;
    const originalForm = form().find((node) => node.type === "form")!;
    const originalState = forms.get(versionId);
    const post = deferred<Response>();
    fetchMock.mockReturnValueOnce(post.promise);
    const pending = submit();
    hooks.ready = false;
    hooks.accountId = null;
    render();
    expect(wrapper().key).toBe(originalKey);
    expect(forms.get(versionId)).toBe(originalState);
    expect(form().find((node) => node.type === "form")?.type).toBe(originalForm.type);
    expect((requests("POST")[0][1].signal as AbortSignal).aborted).toBe(false);
    expect(nodes[0].props["aria-busy"]).toBe(true);
    hooks.ready = true;
    hooks.accountId = accountId;
    render();
    expect(wrapper().key).toBe(originalKey);
    post.resolve(Response.json({ ok: true }));
    await pending;
    await settle();
    expect(nodes.map(text).join(" ")).toContain(
      "Decision recorded. The review queue is up to date.",
    );
  });
  it.each([accountChangedEvent, accountUnavailableEvent])(
    "clears private rows immediately and ignores a late read after %s",
    async (event) => {
      render();
      await settle();
      const read = deferred<Response>();
      fetchMock.mockReturnValueOnce(read.promise);
      refresh();
      const signal = requests("GET")[1][1].signal as AbortSignal;
      window.dispatchEvent(new Event(event));
      render();
      expect(signal.aborted).toBe(true);
      expect(nodes.some((node) => node.props.kind === "version")).toBe(false);
      const writes = hooks.writes;
      read.resolve(Response.json(queue()));
      await settle();
      expect(hooks.writes).toBe(writes);
      expect(nodes.some((node) => node.props.kind === "version")).toBe(false);
    },
  );
  it("aborts a queue read and suppresses all late writes after unmount", async () => {
    const read = deferred<Response>();
    fetchMock.mockReturnValueOnce(read.promise);
    render();
    await Promise.resolve();
    const signal = requests("GET")[0][1].signal as AbortSignal;
    unmount();
    const writes = hooks.writes;
    read.resolve(Response.json(queue()));
    await Promise.resolve();
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
    expect(hooks.writes).toBe(writes);
  });
});

describe("actual moderator decision handlers", () => {
  it("prevents same-form double submission and other actions before a pending state can render", async () => {
    render();
    await settle();
    const post = deferred<Response>();
    fetchMock.mockReturnValueOnce(post.promise);
    const stale = form().find((node) => node.type === "form")!;
    const handler = stale.props.onSubmit as (event: unknown) => Promise<void>;
    const event = {
      preventDefault() {},
      currentTarget: { decision: "reject", reason: "Correct these rights." },
    };
    const first = handler(event);
    await handler(event);
    await submit({}, "video");
    refresh();
    expect(requests("POST")).toHaveLength(1);
    expect(requests("GET")).toHaveLength(1);
    expect(requests("POST")[0][1].headers["X-AIVerse-Account"]).toBe(accountId);
    post.resolve(Response.json({ ok: true }));
    await first;
    await settle();
  });
  it("waits for a post-decision refresh, removes the old row and returns keyboard focus to Refresh", async () => {
    render();
    await settle();
    const read = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true })).mockReturnValueOnce(read.promise);
    const pending = submit();
    await settle();
    expect(nodes[0].props["aria-busy"]).toBe(true);
    expect(nodes.some((node) => node.props.kind === "version")).toBe(false);
    refresh();
    expect(requests("GET")).toHaveLength(2);
    read.resolve(Response.json(queue({ versions: [] })));
    await pending;
    await settle();
    runFrames();
    expect(nodes[0].props["aria-busy"]).toBe(false);
    expect(nodes.map(text).join(" ")).toContain(
      "Decision recorded. The review queue is up to date.",
    );
    expect(focus).toHaveBeenCalledOnce();
  });
  it("retains confirmed success when the reload fails, with an actionable queue retry", async () => {
    render();
    await settle();
    fetchMock
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockRejectedValueOnce(new Error("offline"));
    await submit();
    await settle();
    runFrames();
    expect(nodes.map(text).join(" ")).toContain(
      "The decision was saved, but the queue could not reload",
    );
    expect(nodes.some((node) => node.props.kind === "version")).toBe(false);
    refresh();
    await settle();
    expect(nodes.some((node) => node.props.kind === "version")).toBe(true);
    expect(requests("POST")).toHaveLength(1);
  });
  it.each([
    new Error("offline"),
    new Response("not json", { status: 502 }),
    Response.json({ ok: false }),
  ])(
    "keeps a recoverable failure and its form input, without claiming success",
    async (failure) => {
      render();
      await settle();
      if (failure instanceof Error) fetchMock.mockRejectedValueOnce(failure);
      else fetchMock.mockResolvedValueOnce(failure);
      await submit();
      const current = form();
      expect(current.some((node) => node.props.role === "alert")).toBe(true);
      const error = current.find((node) => node.props.role === "alert")!;
      expect(text(error)).toContain("Your input is kept. Refresh the queue before retrying.");
      expect(current.find((node) => node.type === "textarea")?.props["aria-describedby"]).toBe(
        error.props.id,
      );
      expect(current.find((node) => node.type === "fieldset")?.props.disabled).toBe(false);
      expect(requests("GET")).toHaveLength(1);
      expect(nodes.map(text).join(" ")).not.toContain("Decision recorded");
    },
  );
  it.each([401, 403, 409])(
    "clears obsolete review controls after a %i decision response",
    async (status) => {
      render();
      await settle();
      fetchMock.mockResolvedValueOnce(Response.json({ error: "Changed" }, { status }));
      await submit();
      await settle();
      expect(nodes.some((node) => node.props.kind === "version")).toBe(false);
      expect(nodes.map(text).join(" ")).toContain("Your access or this submission changed");
      runFrames();
      expect(focus).toHaveBeenCalledOnce();
    },
  );
  it("does not convert a manipulated unknown decision to a rejection", async () => {
    render();
    await settle();
    await submit({ decision: "unknown" });
    expect(requests("POST")).toHaveLength(0);
    expect(form().some((node) => node.props.role === "alert")).toBe(true);
  });
  it.each([accountChangedEvent, accountUnavailableEvent])(
    "aborts a decision after %s and ignores its late success",
    async (event) => {
      render();
      await settle();
      const post = deferred<Response>();
      fetchMock.mockReturnValueOnce(post.promise);
      const pending = submit();
      const signal = requests("POST")[0][1].signal as AbortSignal;
      window.dispatchEvent(new Event(event));
      render();
      expect(signal.aborted).toBe(true);
      const writes = hooks.writes;
      post.resolve(Response.json({ ok: true }));
      await pending;
      await settle();
      expect(hooks.writes).toBe(writes);
      expect(requests("GET")).toHaveLength(1);
      expect(nodes.map(text).join(" ")).not.toContain("Decision recorded");
    },
  );
});
