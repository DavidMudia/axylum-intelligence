"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ElementType } from "react";
import { cn } from "@/lib/format";
import { useUI } from "@/stores/ui";
import { NAV } from "./nav";
import { LineChart, OctagonAlert, PanelRight } from "lucide-react";

type Item = { id: string; group: string; label: string; hint?: string; icon: ElementType; run: () => void };

export function CommandPalette() {
  const { paletteOpen, setPalette, streamOpen, setStreamOpen } = useUI();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!useUI.getState().paletteOpen);
      }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalette]);

  useEffect(() => {
    if (paletteOpen) {
      const timer = window.setTimeout(() => {
        setQ("");
        setIdx(0);
        input.current?.focus();
      }, 20);
      return () => window.clearTimeout(timer);
    }
  }, [paletteOpen]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      setPalette(false);
    };
    return [
      ...NAV.map((n) => ({ id: n.href, group: "Navigate", label: n.label, hint: n.hint, icon: n.icon, run: go(n.href) })),
      {
        id: "BTCUSDT",
        group: "Markets",
        label: "BTCUSDT",
        hint: "Configured market-data pair",
        icon: LineChart,
        run: go("/markets"),
      },
      { id: "op-kill", group: "Operations", label: "Open emergency controls", hint: "Security", icon: OctagonAlert, run: go("/security") },
      {
        id: "op-stream",
        group: "Operations",
        label: "Toggle activity stream",
        hint: "Interface",
        icon: PanelRight,
        run: () => {
          setStreamOpen(!streamOpen);
          setPalette(false);
        },
      },
    ];
  }, [router, setPalette, setStreamOpen, streamOpen]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => `${i.label} ${i.hint ?? ""} ${i.group}`.toLowerCase().includes(s)) : items;
  }, [items, q]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      filtered[idx]?.run();
    }
  };

  let lastGroup = "";
  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/55 px-4 pt-[14vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={() => setPalette(false)}
        >
          <motion.div
            role="dialog"
            aria-label="Command palette"
            className="glass w-full max-w-[580px] overflow-hidden"
            style={{ background: "rgba(16,19,27,0.92)" }}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b hairline px-4 py-3.5">
              <Search size={16} className="text-fg-3" />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setIdx(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Go to a page, market or operation…"
                className="w-full bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-3"
              />
              <kbd className="num rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-fg-3">ESC</kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {filtered.map((it, i) => {
                const header = it.group !== lastGroup;
                lastGroup = it.group;
                const Icon = it.icon;
                return (
                  <div key={it.group + it.id}>
                    {header && <div className="eyebrow px-3 pb-1 pt-3">{it.group}</div>}
                    <button
                      onMouseEnter={() => setIdx(i)}
                      onClick={it.run}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[13px] transition-colors",
                        i === idx ? "bg-white/[0.07] text-fg" : "text-fg-2",
                      )}
                    >
                      <Icon size={15} strokeWidth={1.6} className="text-fg-3" />
                      <span className="flex-1">{it.label}</span>
                      {it.hint && <span className="text-[11.5px] text-fg-3">{it.hint}</span>}
                      {i === idx && <CornerDownLeft size={13} className="text-fg-3" />}
                    </button>
                  </div>
                );
              })}
              {!filtered.length && <div className="px-4 py-10 text-center text-[13px] text-fg-3">No results for “{q}”</div>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
