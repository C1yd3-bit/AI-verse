import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  AppearanceController,
  appearanceBootScript,
  appearanceStorageKey,
  applyAppearance,
  readDeviceAppearance,
} from "@/lib/appearance";

const accountA = "1c78233d-983a-463e-9141-5eb0679e7a92";
const accountB = "e55369d5-7882-4471-86fc-776332d24d91";
const snapshot = (accountId: string, theme: "light" | "dark") =>
  Response.json({ accountId, appearance: { theme } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness(device: "light" | "dark" = "dark") {
  const request = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  const apply = vi.fn();
  const controller = new AppearanceController({ request, apply, device: () => device });
  return { controller, request, apply };
}
afterEach(() => vi.unstubAllGlobals());

describe("account appearance synchronization", () => {
  it("keeps a device fallback separate from a new account's saved default", async () => {
    const { controller, request, apply } = harness("light");
    controller.restoreDevice();
    request.mockResolvedValueOnce(snapshot(accountB, "dark"));
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      theme: "dark",
      accountId: accountB,
      ready: true,
    });
    expect(apply.mock.calls).toEqual([["light"], ["dark"]]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.method).toBeUndefined();
  });

  it("does not apply or persist a selection before its server acknowledgement", async () => {
    const { controller, request, apply } = harness();
    request.mockResolvedValueOnce(snapshot(accountA, "dark"));
    await controller.refresh();
    apply.mockClear();
    const pending = deferred<Response>();
    request.mockReturnValueOnce(pending.promise);
    const save = controller.setTheme("light");
    expect(controller.getSnapshot()).toMatchObject({ theme: "dark", saving: true });
    expect(apply).not.toHaveBeenCalled();
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
      action: "appearance",
      theme: "light",
    });
    expect(new Headers(request.mock.calls[1][1]?.headers).get("X-AIVerse-Account")).toBe(accountA);
    pending.resolve(Response.json({ ok: true }));
    expect(await save).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ theme: "light", saving: false });
    expect(apply).toHaveBeenCalledExactlyOnceWith("light");
  });

  it("leaves the previous appearance intact and exposes a recoverable save failure", async () => {
    const { controller, request, apply } = harness();
    request.mockResolvedValueOnce(snapshot(accountA, "dark"));
    await controller.refresh();
    apply.mockClear();
    request.mockResolvedValueOnce(
      Response.json({ error: "Database unavailable" }, { status: 502 }),
    );
    await expect(controller.setTheme("light")).rejects.toThrow("could not save");
    expect(controller.getSnapshot()).toMatchObject({ theme: "dark", saving: false, ready: true });
    expect(apply).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(Response.json({ ok: true }));
    await controller.setTheme("light");
    expect(controller.getSnapshot().error).toBe("");
  });

  it("ignores account A's late read after account B has loaded", async () => {
    const { controller, request } = harness();
    const stale = deferred<Response>();
    request.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(snapshot(accountB, "dark"));
    const first = controller.refresh();
    await controller.refresh();
    stale.resolve(snapshot(accountA, "light"));
    await first;
    expect(controller.getSnapshot()).toMatchObject({
      theme: "dark",
      accountId: accountB,
      ready: true,
    });
  });

  it("ignores a late successful save after the account identity changes", async () => {
    const { controller, request, apply } = harness();
    request.mockResolvedValueOnce(snapshot(accountA, "dark"));
    await controller.refresh();
    const stale = deferred<Response>();
    request.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(snapshot(accountB, "dark"));
    const save = controller.setTheme("light");
    await controller.refresh();
    apply.mockClear();
    stale.resolve(Response.json({ ok: true }));
    expect(await save).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      theme: "dark",
      accountId: accountB,
      ready: true,
      saving: false,
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("finishes an acknowledged save after a same-account refresh returns the old theme", async () => {
    const { controller, request, apply } = harness();
    request.mockResolvedValueOnce(snapshot(accountA, "dark"));
    await controller.refresh();
    apply.mockClear();
    const pending = deferred<Response>();
    request.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(snapshot(accountA, "dark"));
    const save = controller.setTheme("light");
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      accountId: accountA,
      ready: true,
      saving: true,
      theme: "dark",
    });
    expect(apply).not.toHaveBeenCalled();
    pending.resolve(Response.json({ ok: true }));
    expect(await save).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      accountId: accountA,
      ready: true,
      saving: false,
      theme: "light",
      error: "",
    });
    expect(apply).toHaveBeenCalledExactlyOnceWith("light");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("reconciles identity after an acknowledged save while a same-account read is still outstanding", async () => {
    const { controller, request, apply } = harness();
    request.mockResolvedValueOnce(snapshot(accountA, "dark"));
    await controller.refresh();
    apply.mockClear();
    const pendingWrite = deferred<Response>();
    const oldRead = deferred<Response>();
    request
      .mockReturnValueOnce(pendingWrite.promise)
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(snapshot(accountA, "light"));
    const save = controller.setTheme("light");
    const refresh = controller.refresh();
    pendingWrite.resolve(Response.json({ ok: true }));
    expect(await save).toBe(true);
    oldRead.resolve(snapshot(accountA, "dark"));
    await refresh;
    expect(controller.getSnapshot()).toMatchObject({
      theme: "light",
      accountId: accountA,
      ready: true,
      saving: false,
    });
    expect(apply).toHaveBeenCalledExactlyOnceWith("light");
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("keeps a failed save visible after a same-account refresh, with the previous theme intact", async () => {
    const { controller, request, apply } = harness();
    request.mockResolvedValueOnce(snapshot(accountA, "dark"));
    await controller.refresh();
    apply.mockClear();
    const pending = deferred<Response>();
    request.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(snapshot(accountA, "dark"));
    const save = controller.setTheme("light");
    await controller.refresh();
    pending.resolve(Response.json({ error: "Unavailable" }, { status: 502 }));
    await expect(save).rejects.toThrow("could not save");
    expect(controller.getSnapshot()).toMatchObject({
      theme: "dark",
      accountId: accountA,
      ready: true,
      saving: false,
    });
    expect(controller.getSnapshot().error).toContain("could not save");
    expect(apply).not.toHaveBeenCalled();
  });

  it("drops an old account save when the post-write identity reconciliation finds a different account", async () => {
    const { controller, request, apply } = harness();
    request.mockResolvedValueOnce(snapshot(accountA, "dark"));
    await controller.refresh();
    const pendingWrite = deferred<Response>();
    const oldRead = deferred<Response>();
    request
      .mockReturnValueOnce(pendingWrite.promise)
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(snapshot(accountB, "dark"));
    const save = controller.setTheme("light");
    const refresh = controller.refresh();
    apply.mockClear();
    pendingWrite.resolve(Response.json({ ok: true }));
    expect(await save).toBe(false);
    oldRead.resolve(snapshot(accountA, "dark"));
    await refresh;
    expect(controller.getSnapshot()).toMatchObject({
      theme: "dark",
      accountId: accountB,
      ready: true,
      saving: false,
    });
    expect(apply).not.toHaveBeenCalledWith("light");
  });

  it("clears account context on unauthorized reads and never writes a guest fallback", async () => {
    const { controller, request } = harness("light");
    request
      .mockResolvedValueOnce(snapshot(accountA, "dark"))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    await controller.refresh();
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      theme: "light",
      accountId: null,
      ready: false,
    });
    await expect(controller.setTheme("dark")).rejects.toThrow("Reload your account");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("clears identity on a rejected write and refuses overlapping writes", async () => {
    const { controller, request } = harness();
    request.mockResolvedValueOnce(snapshot(accountA, "dark"));
    await controller.refresh();
    const pending = deferred<Response>();
    request.mockReturnValueOnce(pending.promise);
    const save = controller.setTheme("light");
    await expect(controller.setTheme("dark")).rejects.toThrow("finish saving");
    pending.resolve(new Response(null, { status: 403 }));
    await expect(save).rejects.toThrow("session changed");
    expect(controller.getSnapshot()).toMatchObject({
      accountId: null,
      ready: false,
      saving: false,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid snapshot themes instead of assigning arbitrary DOM attributes", async () => {
    const { controller, request, apply } = harness();
    request.mockResolvedValueOnce(
      Response.json({ accountId: accountA, appearance: { theme: "malformed" } }),
    );
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({ ready: false, accountId: null });
    expect(controller.getSnapshot().error).toContain("could not load");
    expect(apply).not.toHaveBeenCalled();
  });

  it("treats a cross-tab identity conflict as a session change, with no appearance write applied", async () => {
    const { controller, request, apply } = harness();
    request.mockResolvedValueOnce(snapshot(accountA, "dark"));
    await controller.refresh();
    apply.mockClear();
    request.mockResolvedValueOnce(Response.json({ error: "Account changed" }, { status: 409 }));
    await expect(controller.setTheme("light")).rejects.toThrow("session changed");
    expect(controller.getSnapshot()).toMatchObject({
      accountId: null,
      ready: false,
      theme: "dark",
    });
    expect(apply).not.toHaveBeenCalledWith("light");
    expect(new Headers(request.mock.calls[1][1]?.headers).get("X-AIVerse-Account")).toBe(accountA);
  });
});

describe("safe device appearance before paint", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["unknown", "dark"],
    [null, "dark"],
  ])("validates stored %s before assigning %s", (stored, expected) => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(appearanceBootScript, { document, localStorage: { getItem: () => stored } });
    expect(document.documentElement.dataset.theme).toBe(expected);
  });
  it("handles blocked storage without breaking document parsing or saved account styling", () => {
    const document = { documentElement: { dataset: { theme: "dark" } } };
    const localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => runInNewContext(appearanceBootScript, { document, localStorage })).not.toThrow();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("document", document);
    expect(readDeviceAppearance()).toBe("dark");
    expect(() => applyAppearance("light")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("stores only an allowlisted device theme under its dedicated key", () => {
    const localStorage = { getItem: vi.fn(() => "light"), setItem: vi.fn() };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    expect(readDeviceAppearance()).toBe("light");
    applyAppearance("dark");
    expect(localStorage.setItem).toHaveBeenCalledExactlyOnceWith(appearanceStorageKey, "dark");
  });
});
