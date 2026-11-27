"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Cable, OctagonAlert, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, PageHeader, Panel, PanelHeader, StatusDot, Tabs } from "@/components/glass";
import { cn, fmtDateTime } from "@/lib/format";
import type { OperatingState } from "@/stores/ui";
import { useUI } from "@/stores/ui";

type Entry = { id: number; actor: string; action: string; detail: string; severity: string; createdAt: string };
type RuntimeHealth = {
  database?: { state?: string; error?: string };
  collector?: { state?: string; fresh?: boolean; ageMs?: number | null };
  checkedAt?: string;
};

function apiError(body: unknown, fallback: string) {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
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

function formatAge(ageMs: number | null | undefined) {
  if (ageMs == null || !Number.isFinite(ageMs)) return "No recent message";
  if (ageMs < 1000) return "Just now";
  return ageMs < 60_000 ? `${Math.floor(ageMs / 1000)}s ago` : `${Math.floor(ageMs / 60_000)}m ago`;
}

export default function Security() {
  const { system, setSystem } = useUI();
  const [tab, setTab] = useState<"controls" | "audit">("controls");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stateReady, setStateReady] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const response = await fetch("/api/audit", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to load the audit log."));
      if (typeof body !== "object" || body === null || !("entries" in body) || !Array.isArray(body.entries)) {
        throw new Error("The audit-log response was invalid.");
      }
      setEntries(body.entries as Entry[]);
      setAuditError(null);
    } catch (loadError) {
      setAuditError(loadError instanceof Error ? loadError.message : "Unable to load the audit log.");
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Runtime health is unavailable."));
      if (typeof body !== "object" || body === null) throw new Error("The runtime-health response was invalid.");
      setHealth(body as RuntimeHealth);
      setHealthError(null);
    } catch (loadError) {
      setHealthError(loadError instanceof Error ? loadError.message : "Runtime health is unavailable.");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadSystemState = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to load operating state."));
      if (!isOperatingState(body)) throw new Error("The operating-state response was invalid.");
      setSystem(body);
      setOperationError(null);
      setStateReady(true);
    } catch (loadError) {
      setOperationError(loadError instanceof Error ? loadError.message : "Unable to load operating state.");
      setStateReady(false);
    }
  }, [setSystem]);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void loadAudit();
      void loadHealth();
      void loadSystemState();
    }, 0);
    return () => window.clearTimeout(initial);
  }, [loadAudit, loadHealth, loadSystemState]);

  const setKill = async (value: boolean) => {
    setBusy(true);
    setOperationError(null);
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "killSwitch", value }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to update emergency trading shutdown."));
      if (!isOperatingState(body)) throw new Error("The operating-state response was invalid.");
      setSystem(body);
      setConfirm(false);
      await loadAudit();
    } catch (requestError) {
      setOperationError(requestError instanceof Error ? requestError.message : "Unable to update emergency trading shutdown.");
    } finally {
      setBusy(false);
    }
  };

  const databaseState = health?.database?.state ?? (healthError ? "unavailable" : "checking");
  const collectorState = health?.collector
    ? `${health.collector.state ?? "unknown"} · ${health.collector.fresh ? "fresh" : formatAge(health.collector.ageMs)}`
    : "Not reported by this health response";

  return (
    <>
      <PageHeader
        eyebrow="Security and administration"
        title="Controls and audit"
        description="Emergency controls, connected-account management, and persisted audit events. Secrets and unsupported security telemetry are not displayed."
      />
      <div className="mb-6">
        <Tabs
          id="sec"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "controls", label: "Controls" },
            { key: "audit", label: "Audit log" },
          ]}
        />
      </div>

      {tab === "controls" ? (
        <div className="space-y-5">
          <Panel hover={false} tone={system.killSwitch ? "crimson" : undefined} className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div className="flex items-start gap-4">
                <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl border", system.killSwitch ? "border-down/40 bg-down/15 text-down" : "border-white/10 bg-white/[0.04] text-fg-2")}>
                  <OctagonAlert size={20} strokeWidth={1.6} />
                </div>
                <div>
                  <div className="eyebrow">Emergency control</div>
                  <h3 className="mt-1 text-[17px] font-medium text-fg">{system.killSwitch ? "Emergency shutdown is active" : "Emergency trading shutdown"}</h3>
                  <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-fg-2">
                    Stops new order submissions while preserving the ability to inspect and reduce existing positions.
                  </p>
                </div>
              </div>
              {system.killSwitch ? (
                <Button onClick={() => void setKill(false)} disabled={busy || !stateReady}>
                  Release shutdown
                </Button>
              ) : confirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-fg-2">Halt all new orders?</span>
                  <Button variant="danger" onClick={() => void setKill(true)} disabled={busy || !stateReady}>
                    {busy ? "Applying…" : "Confirm shutdown"}
                  </Button>
                  <Button onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirm(true)} disabled={!stateReady}>
                  Engage emergency shutdown
                </Button>
              )}
            </div>
            {operationError && <p role="alert" className="mt-4 text-[12px] text-down">{operationError}</p>}
          </Panel>

          <div className="grid gap-5 lg:grid-cols-5">
            <Panel hover={false} className="lg:col-span-3">
              <PanelHeader eyebrow="Trading integrations" title="Connection management" />
              <div className="flex items-start gap-3 px-5 pb-5">
                <Cable size={17} className="mt-0.5 text-fg-3" />
                <div>
                  <p className="text-[12.5px] leading-relaxed text-fg-2">
                    Connection status and credential changes are managed through the authenticated Accounts page. API secrets are never displayed here.
                  </p>
                  <Link href="/accounts" className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[#9db8f5] hover:text-fg">
                    Manage accounts and integrations <ShieldCheck size={13} />
                  </Link>
                </div>
              </div>
            </Panel>
            <Panel hover={false} className="lg:col-span-2">
              <PanelHeader
                eyebrow="Runtime health"
                title="Live service status"
                action={<Button onClick={() => void loadHealth()} disabled={healthLoading}><RefreshCw size={12} className={healthLoading ? "animate-spin" : ""} /> Refresh</Button>}
              />
              <div className="space-y-3 px-5 pb-5 text-[12.5px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-fg-2">Database</span>
                  <span className="flex items-center gap-2 text-fg">
                    <StatusDot status={databaseState === "healthy" ? "ok" : databaseState === "unavailable" ? "down" : "degraded"} />
                    {databaseState}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-fg-2">Market collector</span>
                  <span className="text-right text-fg-3">{collectorState}</span>
                </div>
                {health?.checkedAt && <div className="border-t hairline pt-3 text-[11px] text-fg-3">Checked {new Date(health.checkedAt).toLocaleString()}</div>}
                {healthError && <p role="alert" className="text-[11.5px] text-down">{healthError}</p>}
              </div>
            </Panel>
          </div>
        </div>
      ) : (
        <Panel hover={false}>
          <PanelHeader
            eyebrow="Persisted audit events"
            title="Recent entries"
            action={<Button onClick={() => void loadAudit()} disabled={auditLoading}><RefreshCw size={12} className={auditLoading ? "animate-spin" : ""} /> Refresh</Button>}
          />
          {auditError && <p role="alert" className="mx-5 mb-4 rounded-lg border border-down/25 bg-down/[0.06] px-4 py-3 text-[12px] text-fg-2">{auditError}</p>}
          <div className="divide-y divide-white/[0.06]">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-4 px-5 py-3.5">
                <span className="num w-[84px] shrink-0 pt-0.5 text-[11px] text-fg-3">{fmtDateTime(entry.createdAt).slice(5, 16)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="num text-[12px] text-[#9db8f5]">{entry.action}</span>
                    <Badge tone={entry.severity === "critical" ? "crimson" : entry.severity === "warn" ? "amber" : "neutral"}>{entry.severity}</Badge>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-fg-2">{entry.detail}</p>
                </div>
                <span className="text-[11px] text-fg-3">{entry.actor}</span>
              </div>
            ))}
            {!auditLoading && !auditError && !entries.length && <div className="px-5 py-10 text-center text-[13px] text-fg-3">No audit entries have been recorded.</div>}
          </div>
          {auditLoading && <div className="px-5 py-4 text-center text-[12px] text-fg-3">Loading audit log…</div>}
        </Panel>
      )}
    </>
  );
}
