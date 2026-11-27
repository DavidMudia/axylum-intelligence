"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
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

type SubscriptionAdminData = {
  accounts: Array<{
    id: string;
    email: string;
    role: string;
    status: string;
    createdAt: string;
    planId: string | null;
    planName: string | null;
    subscriptionStatus: string | null;
    subscriptionSource: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    complimentarySlot: number | null;
  }>;
  page: number;
  pageSize: number;
  total: number;
  plans: Array<{ id: string; name: string; amountMinor: number; enabled: boolean }>;
  subscriptionBreakdown: Array<{ planId: string; status: string; source: string; count: number }>;
  payments: Array<{
    id: string;
    email: string;
    planId: string;
    reference: string;
    amountMinor: number;
    currency: string;
    status: string;
    paidAt: string | null;
    createdAt: string;
  }>;
  paystackCheckoutAvailable: boolean;
  metrics: {
    totalUsers: number;
    payingSubscribers: number;
    monthlyRecurringRevenueMinor: number;
    verifiedRevenue30dMinor: number;
    failedPayments: number;
    suspendedUsers: number;
  };
};

function currency(amountMinor: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amountMinor / 100);
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionAdminData | null>(null);
  const [viewerRole, setViewerRole] = useState("");
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [userBusy, setUserBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search.trim()) params.set("q", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (planFilter) params.set("plan", planFilter);
      const [complimentaryResponse, subscriptionResponse, sessionResponse] = await Promise.all([
        fetch("/api/admin/complimentary", { cache: "no-store" }),
        fetch(`/api/admin/subscriptions?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/auth/session", { cache: "no-store" }),
      ]);
      const [complimentaryBody, subscriptionBody, sessionBody] = await Promise.all([
        complimentaryResponse.json() as Promise<AdminData & { error?: string }>,
        subscriptionResponse.json() as Promise<SubscriptionAdminData & { error?: string }>,
        sessionResponse.json() as Promise<{ user?: { role?: string } }>,
      ]);
      if (!complimentaryResponse.ok) throw new Error(complimentaryBody.error ?? "Unable to load platform administration");
      if (!subscriptionResponse.ok) throw new Error(subscriptionBody.error ?? "Unable to load user subscriptions");
      setData(complimentaryBody);
      setSubscriptions(subscriptionBody);
      setViewerRole(sessionBody.user?.role ?? "");
      setError("");
    } finally {
      setLoading(false);
    }
  }, [page, planFilter, search, statusFilter]);

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

  const manageUser = async (userId: string, action: string, payload: Record<string, unknown> = {}) => {
    setUserBusy(userId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId, ...payload }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to update account");
      setNotice("Account update saved.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUserBusy("");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={viewerRole === "owner" ? "Platform owner" : "Platform administrator"}
        title="Administration"
        description={viewerRole === "owner"
          ? "Manage the four assignable permanent Professional accounts and review subscription revenue."
          : "Review user access, subscriptions, verified payments and platform revenue."}
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
                    viewerRole === "owner" ? (
                    <Button variant="danger" disabled={busy} onClick={() => void submit("revoke", { slotNumber: slot.slotNumber })}>
                      Revoke slot
                    </Button>
                    ) : <Badge tone="neutral">Assigned</Badge>
                  ) : (
                    <Badge tone="neutral">Available</Badge>
                  )}
                </div>
              ))}
            </div>
            {viewerRole === "owner" && <form onSubmit={(event) => { event.preventDefault(); void submit("assign", { email }); }} className="flex flex-wrap gap-2 border-t hairline px-5 py-4">
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
            </form>}
          </Panel>

          <Panel hover={false} className="mb-5">
            <PanelHeader eyebrow="Accounts and subscription administration" title="User access" />
            <div className="grid gap-3 border-b hairline px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Failed payments", String(subscriptions?.metrics.failedPayments ?? 0)],
                ["Suspended accounts", String(subscriptions?.metrics.suspendedUsers ?? 0)],
                ["Paystack checkout", subscriptions?.paystackCheckoutAvailable ? "Configured" : "Unavailable"],
                ["Paid plan access", "Verified payments only"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border hairline bg-white/[0.02] p-3">
                  <div className="eyebrow">{label}</div>
                  <div className="mt-1 text-[13px] font-medium text-fg">{value}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b hairline px-5 py-4">
              <form onSubmit={(event) => { event.preventDefault(); setPage(1); void refresh(); }} className="flex min-w-[220px] flex-1 gap-2">
                <input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder="Search email" aria-label="Search users by email" className="min-h-10 min-w-0 flex-1 rounded-lg border hairline bg-black/30 px-3 text-[12px] text-fg outline-none focus:border-accent/40" />
                <Button type="submit" disabled={loading}><Search size={13} /> Search</Button>
              </form>
              <select aria-label="Filter by account status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="min-h-10 rounded-lg border hairline bg-black/30 px-3 text-[12px] text-fg">
                <option value="">All account statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
              <select aria-label="Filter by plan" value={planFilter} onChange={(event) => { setPlanFilter(event.target.value); setPage(1); }} className="min-h-10 rounded-lg border hairline bg-black/30 px-3 text-[12px] text-fg">
                <option value="">All plans</option>
                {subscriptions?.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto px-5">
              <table className="w-full min-w-[920px] text-left text-[11.5px]">
                <thead className="text-fg-4"><tr><th className="py-3">Account</th><th>Plan</th><th>Subscription</th><th>Access</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {subscriptions?.accounts.map((account) => (
                    <tr key={account.id}>
                      <td className="py-3">
                        <div className="break-all text-fg">{account.email}</div>
                        <div className="mt-1 text-[10px] text-fg-4">{account.id.slice(0, 8)}</div>
                      </td>
                      <td>{account.complimentarySlot ? "Professional · Complimentary" : account.planName ?? "Unavailable"}</td>
                      <td>{account.subscriptionSource === "paystack" ? account.subscriptionStatus : account.subscriptionSource ?? "none"}</td>
                      <td><Badge tone={account.status === "suspended" ? "crimson" : "emerald"}>{account.status}</Badge></td>
                      <td><Badge tone={account.role === "owner" ? "violet" : account.role === "admin" ? "blue" : "neutral"}>{account.role}</Badge></td>
                      <td className="text-fg-3">{new Date(account.createdAt).toLocaleDateString()}</td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {account.role !== "owner" && <Button className="px-2 py-1 text-[10px]" disabled={Boolean(userBusy)} onClick={() => void manageUser(account.id, "set_status", { status: account.status === "suspended" ? "active" : "suspended" })}>{account.status === "suspended" ? "Reactivate" : "Suspend"}</Button>}
                          {viewerRole === "owner" && account.role !== "owner" && <Button className="px-2 py-1 text-[10px]" disabled={Boolean(userBusy)} onClick={() => void manageUser(account.id, "set_role", { role: account.role === "admin" ? "user" : "admin" })}>{account.role === "admin" ? "Remove admin" : "Make admin"}</Button>}
                          {account.subscriptionSource === "trial" && account.subscriptionStatus === "trialing" && <Button className="px-2 py-1 text-[10px]" disabled={Boolean(userBusy)} onClick={() => void manageUser(account.id, "return_to_free")}>End trial</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!subscriptions?.accounts.length && <tr><td colSpan={7} className="py-8 text-center text-fg-3">No accounts match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t hairline px-5 py-3 text-[11px] text-fg-3">
              <span>{subscriptions?.total ?? 0} accounts · page {subscriptions?.page ?? page}</span>
              <div className="flex gap-2">
                <Button className="px-2 py-1" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={13} /> Previous</Button>
                <Button className="px-2 py-1" disabled={loading || page * (subscriptions?.pageSize ?? 25) >= (subscriptions?.total ?? 0)} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={13} /></Button>
              </div>
            </div>
          </Panel>

          <Panel hover={false} className="mb-5">
            <PanelHeader eyebrow="Verified payment records" title="Payment history" />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[700px] text-left text-[11.5px]">
                <thead className="text-fg-4"><tr><th className="py-3">Date</th><th>Account</th><th>Plan</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {subscriptions?.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="py-2.5 text-fg-3">{new Date(payment.paidAt ?? payment.createdAt).toLocaleString()}</td>
                      <td className="break-all">{payment.email}</td>
                      <td>{payment.planId}</td>
                      <td>{currency(payment.amountMinor)}</td>
                      <td><Badge tone={payment.status === "success" ? "emerald" : payment.status === "failed" ? "crimson" : "neutral"}>{payment.status}</Badge></td>
                      <td className="font-mono text-[10px] text-fg-3">{payment.reference}</td>
                    </tr>
                  ))}
                  {!subscriptions?.payments.length && <tr><td colSpan={6} className="py-8 text-center text-fg-3">No payment records. Complimentary access creates no payment rows.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="border-t hairline px-5 py-3 text-[11px] text-fg-3">Paid plan changes remain locked until Paystack is configured. Admin actions cannot create paid access or payment records.</p>
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
