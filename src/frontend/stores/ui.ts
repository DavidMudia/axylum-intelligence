"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type OperatingState = {
  mode: "paper" | "live";
  killSwitch: boolean;
  liveAvailable: boolean;
};

type UI = {
  collapsed: boolean;
  streamOpen: boolean;
  paletteOpen: boolean;
  mobileNav: boolean;
  streamDrawer: boolean;
  system: OperatingState;
  setStreamDrawer: (v: boolean) => void;
  toggleCollapsed: () => void;
  setStreamOpen: (v: boolean) => void;
  setPalette: (v: boolean) => void;
  setMobileNav: (v: boolean) => void;
  setSystem: (s: OperatingState) => void;
  refreshSystem: () => Promise<void>;
};

export const useUI = create<UI>()(
  persist(
    (set) => ({
      collapsed: false,
      streamOpen: true,
      paletteOpen: false,
      mobileNav: false,
      streamDrawer: false,
      system: { mode: "paper", killSwitch: false, liveAvailable: false },
      setStreamDrawer: (v) => set({ streamDrawer: v }),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      setStreamOpen: (v) => set({ streamOpen: v }),
      setPalette: (v) => set({ paletteOpen: v }),
      setMobileNav: (v) => set({ mobileNav: v }),
      setSystem: (system) => set({ system }),
      refreshSystem: async () => {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error(`Unable to load operating state (${response.status})`);
        set({ system: await response.json() });
      },
    }),
    {
      name: "axylum-ui-preferences",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
      partialize: (state) => ({ collapsed: state.collapsed, streamOpen: state.streamOpen }),
      skipHydration: true,
    },
  ),
);
