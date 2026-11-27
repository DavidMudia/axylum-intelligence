"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Badge, Button, PageHeader, Panel, PanelHeader } from "@/components/glass";

type AdminData = {
  slots: Array<{
    slotNumber: number;
    founderSlot: boolean;
    userId: string | null;
    email: string | null;
    assignedAt: string | null;
  }>;
  events: Array<{
    id: number;
    slotNumber: number;
    targetEmail: string;
    action: string;
    createdAt: string;
  }>;
  metrics: {
    totalUsers: number;
    payingSubscribers: number;
    monthlyRecurringRevenueMinor: number;
    verifiedRevenue30dMinor: number;
  };
};

function currency(amountMinor: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amountMinor / 100);
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/complimentary", { cache: "no-store" });
      const body = await response.json() as AdminData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load platform administration");
      setData(body);
      setError("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const submit = async (action: "assign" | "revoke", payload: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/complimentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to update complimentary access");
      setNotice(action === "assign" ? "Professional complimentary access assigned." : "Complimentary access revoked.");
      if (action === "assign") setEmail("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Platform owner"
        title="Administration"
        description="Manage the four assignable permanent Professional accounts and review subscription revenue."
        actions={<Button onClick={() => void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))} disabled={loading || busy}><RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh dashboard</Button>}
      />
      <p className="mb-5 text-[12px] text-fg-3"><Link href="/billing" className="text-[#9db8f5] hover:underline">Go to billing</Link></p>
      {error && <div role="alert" className="mb-4 rounded-lg border border-down/30 bg-down/10 px-4 py-3 text-[12px] text-[#ec8696]">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-up/30 bg-up/10 px-4 py-3 text-[12px] text-[#6fd6ad]">{notice}</div>}
      {data && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Total accounts", String(data.metrics.totalUsers)],
              ["Paying subscribers", String(data.metrics.payingSubscribers)],
              ["Monthly recurring revenue", currency(data.metrics.monthlyRecurringRevenueMinor)],
              ["Verified revenue · 30 days", currency(data.metrics.verifiedRevenue30dMinor)],
            ].map(([label, value]) => (
              <Panel key={label} hover={false} className="p-4">
                <div className="eyebrow">{label}</div>
                <div className="mt-2 text-xl font-semibold text-fg">{value}</div>
              </Panel>
            ))}
          </div>

          <Panel hover={false} className="mb-5">
            <PanelHeader eyebrow="Five permanent complimentary accounts" title="Professional access allocation" />
            <div className="divide-y divide-white/[0.06] px-5 pb-3">
              {data.slots.map((slot) => (
                <div key={slot.slotNumber} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[12px] text-fg">
                      <span>Slot {slot.slotNumber}</span>
                      {slot.founderSlot && <Badge tone="violet">Founder</Badge>}
                    </div>
                    <div className="mt-1 break-all text-[11px] text-fg-3">{slot.email ?? "Available"}</div>
                  </div>
                  {slot.founderSlot ? (
                    <Badge tone="violet">Permanent · cannot be revoked</Badge>
                  ) : slot.userId ? (
                    <Button variant="danger" disabled={busy} onClick={() => void submit("revoke", { slotNumber: slot.slotNumber })}>
                      Revoke slot
                    </Button>
                  ) : (
                    <Badge tone="neutral">Available</Badge>
                  )}
                </div>
              ))}
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void submit("assign", { email }); }} className="flex flex-wrap gap-2 border-t hairline px-5 py-4">
              <input
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Existing account email"
                aria-label="Account email to assign complimentary access"
                className="min-h-11 min-w-0 flex-1 rounded-lg border hairline bg-black/30 px-3 text-[12px] text-fg outline-none focus:border-accent/40"
              />
              <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
                {busy ? "Updating…" : "Assign next available slot"}
              </Button>
            </form>
          </Panel>

          <Panel hover={false}>
            <PanelHeader eyebrow="Audit trail" title="Complimentary access changes" />
            {data.events.length === 0 ? (
              <p className="px-5 pb-5 text-[12px] text-fg-3">No assignment or revocation events yet.</p>
            ) : (
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full min-w-[560px] text-left text-[11.5px]">
                  <thead className="text-fg-4"><tr><th className="py-2">Time</th><th>Action</th><th>Slot</th><th>Account</th></tr></thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {data.events.map((event) => (
                      <tr key={event.id}>
                        <td className="py-2.5 text-fg-3">{new Date(event.createdAt).toLocaleString()}</td>
                        <td><Badge tone={event.action === "revoked" ? "crimson" : "emerald"}>{event.action}</Badge></td>
                        <td>{event.slotNumber}</td>
                        <td className="break-all">{event.targetEmail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
