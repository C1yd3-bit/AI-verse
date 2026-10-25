export type AppearanceTheme = "dark" | "light";
export const appearanceStorageKey = "aiverse:appearance";
export const accountChangedEvent = "aiverse:account-changed";
export const accountUnavailableEvent = "aiverse:account-unavailable";

export function isAppearanceTheme(value: unknown): value is AppearanceTheme {
  return value === "dark" || value === "light";
}

/** Device styling is a fallback only; it never becomes an account preference. */
export function readDeviceAppearance(): AppearanceTheme {
  try {
    const stored = window.localStorage.getItem(appearanceStorageKey);
    return isAppearanceTheme(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

export function applyAppearance(theme: AppearanceTheme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(appearanceStorageKey, theme);
  } catch {
    // A saved account preference still works when device storage is unavailable.
  }
}

export function notifyAccountChanged() {
  window.dispatchEvent(new Event(accountChangedEvent));
}

/** Static source only: no identity, credentials or untrusted script interpolation. */
export const appearanceBootScript = `(function(){try{var t=localStorage.getItem("${appearanceStorageKey}");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}})()`;

export type AppearanceState = {
  theme: AppearanceTheme;
  accountId: string | null;
  ready: boolean;
  saving: boolean;
  error: string;
};
export const initialAppearanceState: AppearanceState = {
  theme: "dark",
  accountId: null,
  ready: false,
  saving: false,
  error: "",
};

type AppearanceDependencies = {
  request: (input: string, init?: RequestInit) => Promise<Response>;
  apply: (theme: AppearanceTheme) => void;
  device: () => AppearanceTheme;
};

/** Read generations reject obsolete reads; writes survive refreshes of the same identity. */
export class AppearanceController {
  private state: AppearanceState = initialAppearanceState;
  private listeners = new Set<() => void>();
  private generation = 0;
  private readController: AbortController | null = null;
  private pendingWrite: { accountId: string; confirmed: boolean } | null = null;

  constructor(private dependencies: AppearanceDependencies) {}

  getSnapshot = () => this.state;
  getServerSnapshot = () => initialAppearanceState;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<AppearanceState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  restoreDevice = () => {
    const theme = this.dependencies.device();
    this.dependencies.apply(theme);
    this.update({ theme });
  };
  cancel = () => {
    this.generation += 1;
    this.readController?.abort();
  };
  refresh = async () => {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.readController = controller;
    this.update({ ready: false, saving: this.pendingWrite !== null, accountId: null, error: "" });
    try {
      const response = await this.dependencies.request("/api/me/profile", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (generation !== this.generation) return;
      if (response.status === 401 || response.status === 403) {
        this.pendingWrite = null;
        this.update({ saving: false });
        this.restoreDevice();
        return;
      }
      if (!response.ok) throw new Error("Appearance could not load. Please try again.");
      const data: unknown = await response.json();
      if (generation !== this.generation) return;
      if (
        typeof data !== "object" ||
        data === null ||
        !("accountId" in data) ||
        typeof data.accountId !== "string" ||
        !data.accountId ||
        !("appearance" in data) ||
        typeof data.appearance !== "object" ||
        data.appearance === null ||
        !("theme" in data.appearance) ||
        !isAppearanceTheme(data.appearance.theme)
      )
        throw new Error("Appearance could not load. Please try again.");
      if (this.pendingWrite && this.pendingWrite.accountId !== data.accountId)
        this.pendingWrite = null;
      // A read begun before a pending save may still contain the previous theme.
      // It can confirm identity, but cannot cancel the save or overwrite its result.
      const preservePending = this.pendingWrite && !this.pendingWrite.confirmed;
      if (!preservePending) this.dependencies.apply(data.appearance.theme);
      this.update({
        ...(preservePending ? {} : { theme: data.appearance.theme }),
        accountId: data.accountId,
        ready: true,
        saving: this.pendingWrite !== null,
      });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      this.update({
        error:
          error instanceof Error ? error.message : "Appearance could not load. Please try again.",
      });
    }
  };
  setTheme = async (theme: AppearanceTheme): Promise<boolean> => {
    if (!isAppearanceTheme(theme)) throw new Error("Choose Light or Dark appearance.");
    const accountId = this.state.accountId;
    if (!this.state.ready || !accountId)
      throw new Error("Reload your account before changing appearance.");
    if (this.state.saving) throw new Error("Wait for your appearance to finish saving.");
    this.cancel();
    const write = { accountId, confirmed: false };
    this.pendingWrite = write;
    this.update({ saving: true, error: "" });
    try {
      const response = await this.dependencies.request("/api/me/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AIVerse-Account": accountId },
        body: JSON.stringify({ action: "appearance", theme }),
      });
      if (this.pendingWrite !== write) return false;
      if (response.status === 401 || response.status === 403 || response.status === 409) {
        this.cancel();
        this.update({ accountId: null, ready: false });
        this.restoreDevice();
        throw new Error("Your session changed. Log in again before saving appearance.");
      }
      const data: unknown = await response.json().catch(() => null);
      if (this.pendingWrite !== write) return false;
      if (
        !response.ok ||
        typeof data !== "object" ||
        data === null ||
        !("ok" in data) ||
        data.ok !== true
      )
        throw new Error("Appearance could not save. Please try again.");
      write.confirmed = true;
      if (!this.state.ready || this.state.accountId !== accountId) {
        // The identity read is still outstanding. Replace it with one started
        // after the acknowledged write, so its theme cannot predate that write.
        await this.refresh();
        if (this.pendingWrite !== write) return false;
        if (!this.state.ready || this.state.accountId !== accountId)
          throw new Error("Appearance was saved, but could not reload. Please refresh this page.");
      } else {
        this.dependencies.apply(theme);
        this.update({ theme });
      }
      this.pendingWrite = null;
      this.update({ saving: false });
      return this.state.theme === theme;
    } catch (error) {
      if (this.pendingWrite !== write) return false;
      this.pendingWrite = null;
      const message =
        error instanceof Error ? error.message : "Appearance could not save. Please try again.";
      this.update({ saving: false, error: message });
      throw new Error(message);
    }
  };
}
