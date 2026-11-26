"use client";

import { AnimatePresence, motion } from "framer-motion";
import { OctagonAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { ActivityStream } from "@/components/system-status/ActivityStream";
import { useUI } from "@/stores/ui";
import { CommandPalette } from "./CommandPalette";
import { Logo, NavList, Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { OperatorGate } from "./OperatorGate";
import { PwaRuntime } from "./PwaRuntime";

export function AppShell({ children }: { children: ReactNode }) {
  const { streamOpen, streamDrawer, setStreamDrawer, mobileNav, setMobileNav, system } = useUI();

  return (
    <div className="app-viewport flex overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {system.killSwitch && (
          <div className="flex items-center justify-center gap-2 border-b border-down/30 bg-down/10 px-4 py-1.5 text-[12px] text-[#ec8696]">
            <OctagonAlert size={13} />
            Emergency shutdown active — new orders are blocked. Existing positions remain manageable.
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <main className="app-main min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pt-5 lg:px-8 lg:pt-7">
            <OperatorGate>
              <div className="mx-auto max-w-[1520px]">{children}</div>
            </OperatorGate>
          </main>
          {streamOpen && (
            <aside className="hidden w-[324px] shrink-0 p-4 pl-0 xl:block">
              <ActivityStream />
            </aside>
          )}
        </div>
      </div>

      <CommandPalette />
      <PwaRuntime />

      <AnimatePresence>
        {mobileNav && (
          <motion.div className="fixed inset-0 z-[90] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNav(false)} />
            <motion.div
              className="absolute inset-y-0 left-0 w-[264px] border-r hairline bg-[#0b0e14]/95 p-5"
              initial={{ x: -264 }}
              animate={{ x: 0 }}
              exit={{ x: -264 }}
              transition={{ type: "tween", duration: 0.22 }}
            >
              <div className="flex items-center justify-between pb-8">
                <Logo />
                <button onClick={() => setMobileNav(false)} aria-label="Close navigation" className="p-1 text-fg-3">
                  <X size={16} />
                </button>
              </div>
              <NavList onNavigate={() => setMobileNav(false)} />
            </motion.div>
          </motion.div>
        )}
        {streamDrawer && (
          <motion.div className="fixed inset-0 z-[90] xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setStreamDrawer(false)} />
            <motion.div
              className="absolute inset-y-0 right-0 w-[min(360px,92vw)] p-3"
              initial={{ x: 380 }}
              animate={{ x: 0 }}
              exit={{ x: 380 }}
              transition={{ type: "tween", duration: 0.22 }}
            >
              <ActivityStream onClose={() => setStreamDrawer(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
