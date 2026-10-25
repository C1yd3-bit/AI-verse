"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import {
  accountChangedEvent,
  accountUnavailableEvent,
  AppearanceController,
  applyAppearance,
  appearanceStorageKey,
  readDeviceAppearance,
} from "@/lib/appearance";
import type { AppearanceState, AppearanceTheme } from "@/lib/appearance";

type AppearanceContextValue = AppearanceState & {
  setTheme: (theme: AppearanceTheme) => Promise<boolean>;
  refresh: () => Promise<void>;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [controller] = useState(
    () =>
      new AppearanceController({
        request: async (input, init) => {
          const response = await fetch(input, init);
          if (
            input === "/api/me/profile" &&
            !init?.signal?.aborted &&
            (response.status === 401 || response.status === 403)
          )
            window.dispatchEvent(new Event(accountUnavailableEvent));
          return response;
        },
        apply: applyAppearance,
        device: readDeviceAppearance,
      }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  useLayoutEffect(() => {
    controller.restoreDevice();
  }, [controller]);
  useEffect(() => {
    void controller.refresh();
    return controller.cancel;
  }, [controller, pathname]);
  useEffect(() => {
    const refresh = () => {
      void controller.refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === appearanceStorageKey && !controller.getSnapshot().ready)
        controller.restoreDevice();
    };
    window.addEventListener(accountChangedEvent, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(accountChangedEvent, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", storage);
    };
  }, [controller]);
  return (
    <AppearanceContext.Provider
      value={{ ...state, setTheme: controller.setTheme, refresh: controller.refresh }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("Appearance controls require AppearanceProvider.");
  return value;
}
