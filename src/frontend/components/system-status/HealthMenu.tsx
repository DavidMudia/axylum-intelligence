"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StatusDot } from "@/components/glass";
import { SERVICES } from "@backend/lib/ops";

export function HealthMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const degraded = SERVICES.filter((s) => s.status === "degraded" || s.status === "down").length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border hairline bg-white/[0.03] px-3 py-1.5 text-[12px] text-fg-2 transition-colors hover:bg-white/[0.06]"
      >
        <StatusDot status={degraded ? "degraded" : "ok"} pulse />
        <span className="hidden sm:inline">{degraded ? "Degraded" : "All systems online"}</span>
        <ChevronDown size={13} className="text-fg-3" />
      </button>
      {open && (
        <div className="glass anim-rise absolute right-0 top-[calc(100%+8px)] z-50 w-[300px] p-2 shadow-2xl" style={{ background: "rgba(14,17,24,0.92)" }}>
          <div className="eyebrow px-3 pb-2 pt-2">System health</div>
          {SERVICES.map((s) => (
            <div key={s.key} className="flex items-center justify-between rounded-lg px-3 py-2 text-[12.5px] hover:bg-white/[0.04]">
              <span className="flex items-center gap-2.5 text-fg">
                <StatusDot status={s.status} />
                {s.label}
              </span>
              <span className="num text-[11px] text-fg-3">{s.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
