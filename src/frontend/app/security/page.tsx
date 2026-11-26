"use client";

import { KeyRound, OctagonAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, PageHeader, Panel, PanelHeader, StatusDot, Tabs } from "@/components/glass";
import { cn, fmtDateTime } from "@/lib/format";
import { SERVICES } from "@backend/lib/ops";
import { useUI } from "@/stores/ui";

type Entry = { id: number; actor: string; action: string; detail: string; severity: string; createdAt: string };

const CREDENTIALS = [
  { name: "Binance market-data key", masked: "••••••••3f9a", scopes: ["market-data:read"], status: "Active", note: "Trading and withdrawal scopes not granted" },
  { name: "News API key", masked: "••••••••b21c", scopes: ["articles:read"], status: "Active", note: "Rotated 12 days ago" },
  { name: "Reddit API credentials", masked: "••••••••90de", scopes: ["read"], status: "Active", note: "Rate-limit nearing threshold" },
  { name: "Exchange trading key", masked: "Not configured", scopes: [], status: "Absent", note: "Live execution disabled by design" },
];

const ALERTS = [
  { level: "warn", text: "3 failed requests to Reddit API in the last 10 minutes (HTTP 429)." },
  { level: "info", text: "No unusual authentication patterns detected in the last 24 hours." },
  { level: "info", text: "No outbound requests to non-allow-listed hosts." },
];

export default function Security() {
  const { system, setSystem } = useUI();
  const [tab, setTab] = useState<"controls" | "audit">("controls");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/audit", { cache: "no-store" });
    if (r.ok) setEntries((await r.json()).entries);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const setKill = async (value: boolean) => {
    setBusy(true);
    const r = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "killSwitch", value }) });
    if (r.ok) setSystem(await r.json());
    setConfirm(false);
    await load();
    setBusy(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="Security and administration"
        title="Controls and audit"
        description="Credentials are never displayed. Every sensitive action is recorded in the audit log."
      />
      <div className="mb-6">
        <Tabs
          id="sec"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "controls", label: "Controls" },
            { key: "audit", label: "Audit and alerts" },
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
                    Stops all new order submissions immediately while preserving the ability to inspect and reduce existing positions.
                  </p>
                </div>
              </div>
              {system.killSwitch ? (
                <Button onClick={() => setKill(false)} disabled={busy}>
                  Release shutdown
                </Button>
              ) : confirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-fg-2">Halt all new orders?</span>
                  <Button variant="danger" onClick={() => setKill(true)} disabled={busy}>
                    Confirm shutdown
                  </Button>
                  <Button onClick={() => setConfirm(false)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirm(true)}>
                  Engage emergency shutdown
                </Button>
              )}
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-5">
            <Panel hover={false} className="lg:col-span-3">
              <PanelHeader eyebrow="API credentials" title="Status and permission scopes" />
              <div className="divide-y divide-white/[0.06]">
                {CREDENTIALS.map((c) => (
                  <div key={c.name} className="flex items-start justify-between gap-4 px-5 py-4">
                    <div className="flex gap-3">
                      <KeyRound size={15} className="mt-0.5 text-fg-3" />
                      <div>
                        <div className="text-[13px] text-fg">{c.name}</div>
                        <div className="num mt-1 text-[11.5px] text-fg-3">{c.masked}</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {c.scopes.length ? c.scopes.map((s) => <Badge key={s}>{s}</Badge>) : <span className="text-[11.5px] text-fg-3">No scopes</span>}
                        </div>
                        <div className="mt-1.5 text-[11px] text-fg-3">{c.note}</div>
                      </div>
                    </div>
                    <Badge tone={c.status === "Active" ? "emerald" : "neutral"} dot>
                      {c.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel hover={false} className="lg:col-span-2">
              <PanelHeader eyebrow="Service health" title="Runtime components" />
              <div className="px-3 pb-4">
                {SERVICES.map((s) => (
                  <div key={s.key} className="flex items-center justify-between rounded-lg px-3 py-2.5 text-[12.5px]">
                    <span className="flex items-center gap-2.5 text-fg">
                      <StatusDot status={s.status} />
                      {s.label}
                    </span>
                    <span className="num text-[11px] text-fg-3">{s.detail}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-5">
          <Panel hover={false} className="lg:col-span-3">
            <PanelHeader eyebrow="System audit log" title="Recent entries" action={<Button onClick={load}>Refresh</Button>} />
            <div className="divide-y divide-white/[0.06]">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start gap-4 px-5 py-3.5">
                  <span className="num w-[84px] shrink-0 pt-0.5 text-[11px] text-fg-3">{fmtDateTime(e.createdAt).slice(5, 16)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="num text-[12px] text-[#9db8f5]">{e.action}</span>
                      <Badge tone={e.severity === "critical" ? "crimson" : e.severity === "warn" ? "amber" : "neutral"}>{e.severity}</Badge>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-snug text-fg-2">{e.detail}</p>
                  </div>
                  <span className="text-[11px] text-fg-3">{e.actor}</span>
                </div>
              ))}
              {!entries.length && <div className="px-5 py-10 text-center text-[13px] text-fg-3">No entries.</div>}
            </div>
          </Panel>
          <Panel hover={false} className="lg:col-span-2 self-start">
            <PanelHeader eyebrow="Suspicious activity" title="Alerts and failed requests" />
            <div className="space-y-3 px-5 pb-5">
              {ALERTS.map((a) => (
                <div key={a.text} className={cn("flex gap-3 rounded-[10px] border p-3 text-[12.5px] leading-snug", a.level === "warn" ? "border-warn/25 bg-warn/[0.06] text-fg-2" : "hairline bg-white/[0.02] text-fg-2")}>
                  <ShieldCheck size={14} className={cn("mt-0.5 shrink-0", a.level === "warn" ? "text-warn" : "text-up")} />
                  {a.text}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
