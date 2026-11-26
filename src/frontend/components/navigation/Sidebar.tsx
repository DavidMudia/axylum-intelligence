"use client";

import { motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";
import { useUI } from "@/stores/ui";
import { NAV } from "./nav";

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.02] shadow-[0_0_24px_-6px_rgba(91,141,239,0.5)]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 3 21 20H3L12 3Z" stroke="#9db8f5" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M7.5 14h9" stroke="#9585f2" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="text-[14px] font-semibold tracking-[0.28em] text-fg">AXYLUM</div>
          <div className="mt-1.5 text-[9px] font-medium tracking-[0.22em] text-fg-3">INTELLIGENCE TERMINAL</div>
        </div>
      )}
    </div>
  );
}

export function NavList({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary">
      {NAV.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={compact ? item.label : undefined}
            className={cn(
              "group relative flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              compact && "justify-center px-0",
              active ? "bg-white/[0.06] text-fg" : "text-fg-3 hover:bg-white/[0.035] hover:text-fg-2",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute -left-3 top-2 bottom-2 w-[2px] rounded-full bg-accent shadow-[0_0_10px_rgba(91,141,239,0.9)]"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <Icon size={16} strokeWidth={1.6} className={cn(active ? "text-[#9db8f5]" : "")} />
            {!compact && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

const MOBILE_HREFS = ["/", "/markets", "/trading", "/intelligence"] as const;
const MOBILE_ITEMS = [
  ...MOBILE_HREFS.flatMap((href) => {
    const item = NAV.find((entry) => entry.href === href);
    return item ? [item] : [];
  }),
  { href: "/settings", label: "Settings", icon: Settings2, hint: "Account settings" },
];

export function MobileNav() {
  const path = usePathname();
  return (
    <nav className="mobile-bottom-nav lg:hidden" aria-label="Mobile primary">
      {MOBILE_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = path === item.href || (item.href === "/intelligence" && path.startsWith("/investigation"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={cn("mobile-bottom-nav-item", active && "mobile-bottom-nav-item-active")}
          >
            <Icon size={18} strokeWidth={1.7} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const { collapsed, toggleCollapsed } = useUI();
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r hairline bg-black/20 py-5 backdrop-blur-xl transition-[width] duration-300 lg:flex",
        collapsed ? "w-[72px] px-3" : "w-[236px] px-5",
      )}
    >
      <div className={cn("pb-8", collapsed && "grid place-items-center")}>
        <Logo compact={collapsed} />
      </div>
      <div className="flex-1">
        <NavList compact={collapsed} />
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {!collapsed && (
          <div className="rounded-[10px] border hairline bg-white/[0.025] px-3 py-2.5 text-[11px] leading-relaxed text-fg-3">
            Market data is live when connected; the Knowledge Graph is illustrative; paper trades are simulated.
          </div>
        )}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={cn(
            "flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px] text-fg-3 transition-colors hover:bg-white/[0.04] hover:text-fg-2",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}
