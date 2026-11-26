"use client";

import { Menu, PanelRight, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/glass";
import { HealthMenu } from "@/components/system-status/HealthMenu";
import { useUI } from "@/stores/ui";

function session(h: number) {
  if (h >= 13 && h < 21) return "New York session";
  if (h >= 7 && h < 16) return "London session";
  if (h >= 0 && h < 8) return "Asia session";
  return "After hours";
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="h-8 w-40" />;
  const time = now.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" });
  return (
    <div className="hidden items-center gap-3 text-[12px] md:flex">
      <div className="leading-tight">
        <div className="text-fg-2">{session(now.getUTCHours())}</div>
        <div className="text-[10.5px] text-fg-3">Crypto · 24/7</div>
      </div>
      <span className="num text-[13px] text-fg">{time}</span>
      <span className="text-[10.5px] text-fg-3">UTC</span>
    </div>
  );
}

export function TopBar() {
  const { setPalette, setMobileNav, system, streamOpen, setStreamOpen, setStreamDrawer } = useUI();

  const toggleStream = () => {
    if (window.matchMedia("(min-width: 1280px)").matches) setStreamOpen(!streamOpen);
    else setStreamDrawer(true);
  };

  return (
    <header className="relative z-30 flex h-[60px] shrink-0 items-center gap-4 border-b hairline bg-black/20 px-4 backdrop-blur-xl lg:px-8">
      <button onClick={() => setMobileNav(true)} className="rounded-md p-2 text-fg-2 hover:bg-white/5 lg:hidden" aria-label="Open navigation">
        <Menu size={18} />
      </button>

      <button
        onClick={() => setPalette(true)}
        className="group flex h-9 w-full max-w-[420px] items-center gap-3 rounded-[10px] border hairline bg-white/[0.03] px-3 text-left text-[13px] text-fg-3 transition-colors hover:border-white/15 hover:bg-white/[0.05]"
      >
        <Search size={14} />
        <span className="flex-1 truncate">Search assets, sources, models…</span>
        <kbd className="num hidden rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-fg-3 sm:block">Ctrl K</kbd>
      </button>

      <div className="flex-1" />
      <Clock />
      <div className="mx-1 hidden h-6 w-px bg-white/10 md:block" />
      <HealthMenu />

      <Link href="/trading" title="Operating mode">
        {system.mode === "paper" ? (
          <Badge tone="blue" dot className="px-2.5 py-1 tracking-wider">
            PAPER<span className="hidden sm:inline"> TRADING</span>
          </Badge>
        ) : (
          <Badge tone="crimson" dot className="px-2.5 py-1 tracking-wider">
            LIVE
          </Badge>
        )}
      </Link>

      <button
        onClick={toggleStream}
        aria-label="Toggle activity stream"
        className="rounded-lg border hairline bg-white/[0.03] p-2 text-fg-2 transition-colors hover:bg-white/[0.07] hover:text-fg"
      >
        <PanelRight size={15} />
      </button>
      <Link
        href="/settings"
        aria-label="User settings"
        className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-accent/30 to-violet/30 text-[11px] font-semibold text-fg"
      >
        OP
      </Link>
    </header>
  );
}
