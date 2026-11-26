"use client";

import { create } from "zustand";

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
  asset: string;
  system: OperatingState;
  setStreamDrawer: (v: boolean) => void;
  toggleCollapsed: () => void;
  setStreamOpen: (v: boolean) => void;
  setPalette: (v: boolean) => void;
  setMobileNav: (v: boolean) => void;
  setAsset: (s: string) => void;
  setSystem: (s: OperatingState) => void;
  refreshSystem: () => Promise<void>;
};

export const useUI = create<UI>((set) => ({
  collapsed: false,
  streamOpen: true,
  paletteOpen: false,
  mobileNav: false,
  streamDrawer: false,
  asset: "BTC/USDT",
  system: { mode: "paper", killSwitch: false, liveAvailable: false },
  setStreamDrawer: (v) => set({ streamDrawer: v }),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  setStreamOpen: (v) => set({ streamOpen: v }),
  setPalette: (v) => set({ paletteOpen: v }),
  setMobileNav: (v) => set({ mobileNav: v }),
  setAsset: (asset) => set({ asset }),
  setSystem: (system) => set({ system }),
  refreshSystem: async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) set({ system: await r.json() });
    } catch {
      /* offline */
    }
  },
}));
