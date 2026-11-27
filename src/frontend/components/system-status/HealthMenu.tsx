"use client";

import Link from "next/link";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusDot } from "@/components/glass";

type Health = {
  database?: { state?: string };
  collector?: { state?: string; fresh?: boolean; ageMs?: number | null };
  checkedAt?: string;
};

function responseError(body: unknown) {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return "System health is unavailable.";
}

export function HealthMenu() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(body));
      if (typeof body !== "object" || body === null) throw new Error("System health response was invalid.");
      setHealth(body as Health);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "System health is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const database = health?.database?.state;
  const collector = health?.collector;
  const degraded = !health || (database !== undefined && database !== "healthy") || (collector !== undefined && !collector.fresh);
  const summary = loading && !health ? "Checking system" : error ? "Health unavailable" : collector?.fresh ? "Market data live" : database === "healthy" ? "Database online" : "Health unknown";
  const marketStatus = collector
    ? `${collector.state ?? "unknown"}${collector.fresh ? " · fresh" : collector.ageMs == null ? " · no recent message" : ` · ${Math.floor(collector.ageMs / 1000)}s old`}`
    : "Not reported";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border hairline bg-white/[0.03] px-3 py-1.5 text-[12px] text-fg-2 transition-colors hover:bg-white/[0.06]"
      >
        <StatusDot status={error ? "down" : degraded ? "degraded" : "ok"} pulse />
        <span className="hidden sm:inline">{summary}</span>
        <ChevronDown size={13} className="text-fg-3" />
      </button>
      {open && (
        <div className="glass anim-rise absolute right-0 top-[calc(100%+8px)] z-50 w-[300px] p-2 shadow-2xl" style={{ background: "rgba(14,17,24,0.92)" }}>
          <div className="flex items-center justify-between px-3 pb-2 pt-2">
            <div className="eyebrow">Live system health</div>
            <button onClick={() => void load()} disabled={loading} aria-label="Refresh system health" className="rounded p-1 text-fg-3 hover:text-fg disabled:opacity-50">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
          {error && <p role="alert" className="mx-2 mb-2 rounded-lg border border-down/25 bg-down/[0.06] px-3 py-2 text-[11px] text-fg-2">{error}</p>}
          <div className="flex items-center justify-between rounded-lg px-3 py-2 text-[12px]">
            <span className="flex items-center gap-2.5 text-fg">
              <StatusDot status={database === "healthy" ? "ok" : database ? "down" : "degraded"} />
              Database
            </span>
            <span className="num text-[11px] text-fg-3">{database ?? "Not reported"}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg px-3 py-2 text-[12px]">
            <span className="flex items-center gap-2.5 text-fg">
              <StatusDot status={!collector ? "degraded" : collector.fresh ? "ok" : "down"} />
              Market data
            </span>
            <span className="num text-[11px] text-fg-3">{marketStatus}</span>
          </div>
          {health?.checkedAt && <div className="px-3 py-2 text-[10.5px] text-fg-4">Checked {new Date(health.checkedAt).toLocaleTimeString()}</div>}
          <Link href="/system" onClick={() => setOpen(false)} className="mt-1 block rounded-lg border-t hairline px-3 py-2.5 text-[11.5px] text-[#9db8f5] hover:text-fg">
            Open system details
          </Link>
        </div>
      )}
    </div>
  );
}
