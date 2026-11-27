"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Badge, Button, PageHeader, Panel, PanelHeader, Row } from "@/components/glass";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { cn } from "@/lib/format";
import type { OperatingState } from "@/stores/ui";
import { useUI } from "@/stores/ui";

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onChange} className="relative grid h-11 w-11 shrink-0 place-items-center">
      <span className={cn("relative h-5 w-9 rounded-full border transition-colors", on ? "border-accent/50 bg-accent/40" : "border-white/15 bg-white/[0.06]")}>
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-fg transition-all", on ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}

function isOperatingState(value: unknown): value is OperatingState {
  return typeof value === "object"
    && value !== null
    && "mode" in value
    && (value.mode === "paper" || value.mode === "live")
    && "killSwitch" in value
    && typeof value.killSwitch === "boolean"
    && "liveAvailable" in value
    && typeof value.liveAvailable === "boolean";
}

const WORKFLOWS = [
  { href: "/accounts", label: "Accounts and integrations", detail: "Manage Binance and MT5 connections." },
  { href: "/billing", label: "Billing and subscription", detail: "Review plan access and payment history." },
  { href: "/strategy-lab", label: "Strategy lab", detail: "Configure strategies and run historical backtests." },
  { href: "/trading", label: "Paper trading", detail: "Inspect the paper account and its recorded orders." },
];

export default function Settings() {
  const { collapsed, toggleCollapsed, streamOpen, setStreamOpen, system, setSystem } = useUI();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [systemLoaded, setSystemLoaded] = useState(false);

  const refreshSystem = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Unable to load operating state.";
        throw new Error(message);
      }
      if (!isOperatingState(body)) throw new Error("The operating-state response was invalid.");
      setSystem(body);
      setSystemLoaded(true);
      setError("");
    } catch (loadError) {
      setSystemLoaded(false);
      setError(loadError instanceof Error ? loadError.message : "Unable to load operating state.");
    } finally {
      setLoading(false);
    }
  }, [setSystem]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshSystem(), 0);
    return () => window.clearTimeout(initial);
  }, [refreshSystem]);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Application configuration"
        description="Workspace preferences, live operating state, and shortcuts to supported workflows."
        actions={<Button onClick={() => void refreshSystem()} disabled={loading}><RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh state</Button>}
      />
      {error && <Panel hover={false} tone="crimson" className="mb-5 p-4 text-[12.5px] text-fg">{error}</Panel>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel hover={false}>
          <PanelHeader eyebrow="Interface preferences" title="Workspace" />
          <div className="divide-y divide-white/[0.06] px-5 pb-4">
            <Row label="Compact navigation rail">
              <Toggle on={collapsed} onChange={toggleCollapsed} label="Compact navigation" />
            </Row>
            <Row label="Activity stream panel">
              <Toggle on={streamOpen} onChange={() => setStreamOpen(!streamOpen)} label="Activity stream" />
            </Row>
            <Row label="Configured market">
              <span className="num text-[12px] text-fg-2">BTCUSDT · Binance Spot</span>
            </Row>
            <Row label="Command palette">
              <kbd className="num rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-fg-2">Ctrl K</kbd>
            </Row>
            <Row label="Preference storage">
              <span className="text-[11.5px] text-fg-3">Navigation and activity-panel choices are saved on this device.</span>
            </Row>
          </div>
        </Panel>

        <Panel hover={false}>
          <PanelHeader eyebrow="Server state" title="Operating profile" />
          <div className="divide-y divide-white/[0.06] px-5 pb-4">
            <Row label="Operating mode">
              <Badge tone={!systemLoaded ? "neutral" : system.mode === "paper" ? "blue" : "crimson"} dot>{!systemLoaded ? "Unknown" : system.mode === "paper" ? "Paper trading" : "Live"}</Badge>
            </Row>
            <Row label="Emergency shutdown">
              <Badge tone={!systemLoaded ? "neutral" : system.killSwitch ? "crimson" : "emerald"} dot>{!systemLoaded ? "Unknown" : system.killSwitch ? "Active" : "Inactive"}</Badge>
            </Row>
            <Row label="Live execution">
              <Badge tone={!systemLoaded ? "neutral" : system.liveAvailable ? "emerald" : "neutral"}>{!systemLoaded ? "Unknown" : system.liveAvailable ? "Available" : "Blocked"}</Badge>
            </Row>
            <Row label="Market scope">
              <span className="text-[12px] text-fg-2">BTCUSDT spot · no leverage</span>
            </Row>
          </div>
        </Panel>

        <Panel hover={false} className="lg:col-span-2">
          <PanelHeader eyebrow="Supported workflows" title="Go to a product area" />
          <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2">
            {WORKFLOWS.map((workflow) => (
              <Link key={workflow.href} href={workflow.href} className="group flex items-center justify-between gap-4 rounded-xl border hairline bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.05]">
                <span>
                  <span className="block text-[13px] font-medium text-fg">{workflow.label}</span>
                  <span className="mt-1 block text-[11.5px] text-fg-3">{workflow.detail}</span>
                </span>
                <ArrowRight size={14} className="shrink-0 text-fg-4 transition-colors group-hover:text-[#9db8f5]" />
              </Link>
            ))}
          </div>
        </Panel>
      </div>
      <div className="mt-5">
        <NotificationSettings />
      </div>
    </>
  );
}
