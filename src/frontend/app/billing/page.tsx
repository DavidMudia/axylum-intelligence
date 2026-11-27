"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button, PageHeader, Panel, PanelHeader } from "@/components/glass";

type Plan = {
  id: string;
  name: string;
  description: string;
  currency: string;
  amountMinor: number;
  trialDays: number;
  features: Record<string, boolean | number>;
};

type BillingData = {
  entitlement: {
    planId: string;
    planName: string;
    source: string;
    isComplimentary: boolean;
    periodEndsAt: string | null;
  };
  subscription: {
    status: string;
    source: string;
    cancelAtPeriodEnd: boolean;
    canManageRenewal: boolean;
    pendingPlanId: string | null;
    pendingPlanEffectiveAt: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
  } | null;
  plans: Plan[];
  payments: Array<{
    reference: string;
    planId: string;
    amountMinor: number;
    currency: string;
    status: string;
    paidAt: string | null;
    receiptUrl: string | null;
  }>;
  checkoutAvailable: boolean;
  trialAvailable: boolean;
};

const FEATURE_LABELS: Record<string, string> = {
  market_intelligence: "Market intelligence",
  paper_trading: "Paper trading",
  strategy_builder: "Strategy builder",
  backtests_per_day: "Backtests per day",
  analytics: "Advanced analytics",
  mt5_demo: "MT5 demo integration",
  automated_demo_strategies: "Automated demo strategies",
  advanced_risk: "Advanced risk management",
};

function formatNaira(amountMinor: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/billing", { cache: "no-store" });
      const body = await response.json() as BillingData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load billing details");
      setData(body);
      setError("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const reference = new URLSearchParams(window.location.search).get("reference");
      if (!reference) return;
      setBusy("verify");
      setNotice("Confirming your payment with Paystack…");
      void fetch("/api/billing/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      }).then(async (response) => {
        const body = await response.json() as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Payment could not be verified");
        setNotice("Payment verified. Your subscription is active.");
        window.history.replaceState({}, "", window.location.pathname);
        await refresh();
      }).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setNotice("");
      }).finally(() => setBusy(""));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const begin = async (action: "checkout" | "trial", planId: string) => {
    if (action === "checkout" && !data?.checkoutAvailable) {
      setError("Paystack checkout is unavailable until a Paystack account and server-side credentials are configured.");
      return;
    }
    setBusy(`${action}:${planId}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, planId }),
      });
      const body = await response.json() as { error?: string; authorizationUrl?: string; trial?: { trialEndsAt: string } };
      if (!response.ok) throw new Error(body.error ?? "Unable to update your subscription");
      if (body.authorizationUrl) {
        window.location.assign(body.authorizationUrl);
        return;
      }
      setNotice(`Trial started through ${formatDate(body.trial?.trialEndsAt ?? null)}.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  };

  const manageRenewal = async (action: "cancel" | "resume") => {
    if (action === "cancel" && !window.confirm("Cancel automatic renewal? Your paid access remains available until the current period ends.")) return;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to update renewal settings");
      setNotice(action === "cancel" ? "Automatic renewal has been canceled." : "Automatic renewal has been resumed.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  };

  const endTrial = async () => {
    if (!window.confirm("End your trial now? Your account will return to the Free plan, and this trial cannot be restarted.")) return;
    setBusy("end_trial");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end_trial" }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to end your trial");
      setNotice("Trial ended. Your account is now on the Free plan.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  };

  const currentPlanName = data?.entitlement.isComplimentary
    ? "Professional — Complimentary Access"
    : data?.entitlement.planName ?? "Loading";

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Billing & subscription"
        description="Compare plans, manage access, and review verified Paystack payments."
        actions={<Button onClick={() => void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))} disabled={loading || Boolean(busy)}><RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh billing</Button>}
      />
      {error && <div role="alert" className="mb-4 rounded-lg border border-down/30 bg-down/10 px-4 py-3 text-[12px] text-[#ec8696]">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-up/30 bg-up/10 px-4 py-3 text-[12px] text-[#6fd6ad]">{notice}</div>}
      {data && !data.checkoutAvailable && (
        <div role="status" className="mb-4 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-[12px] leading-relaxed text-amber-100/80">
          Paystack checkout is unavailable until a Paystack account and server-side credentials are configured. Trials remain available where shown; starting a trial does not charge you or create a payment record.
        </div>
      )}
      {loading ? (
        <p className="text-[13px] text-fg-3">Loading subscription…</p>
      ) : data ? (
        <>
          <Panel hover={false} tone={data.entitlement.isComplimentary ? "violet" : "blue"} className="mb-5">
            <PanelHeader eyebrow="Current access" title={currentPlanName} action={
              <Badge tone={data.entitlement.isComplimentary ? "violet" : "emerald"} dot>
                {data.entitlement.isComplimentary ? "Permanent access" : data.subscription?.status ?? "Free"}
              </Badge>
            } />
            <div className="px-5 pb-5 text-[12px] leading-relaxed text-fg-3">
              {data.entitlement.isComplimentary
                ? "Your Professional access is complimentary and permanent. No payment, renewal, or expiration date applies."
                : data.subscription?.status === "trialing"
                  ? `Trial ends ${formatDate(data.subscription.trialEndsAt)}.`
                  : data.subscription?.cancelAtPeriodEnd
                    ? `Automatic renewal is canceled. Access remains available until ${formatDate(data.subscription.currentPeriodEnd)}.`
                  : data.subscription?.currentPeriodEnd
                    ? `Current billing period ends ${formatDate(data.subscription.currentPeriodEnd)}.`
                    : "You are on the Free plan. Choose a paid plan to unlock more capabilities."}
            </div>
            {!data.entitlement.isComplimentary && data.subscription?.source === "paystack" && data.subscription.canManageRenewal && (
              <div className="px-5 pb-5">
                <Button
                  variant={data.subscription.cancelAtPeriodEnd ? "primary" : "danger"}
                  disabled={Boolean(busy)}
                  onClick={() => void manageRenewal(data.subscription!.cancelAtPeriodEnd ? "resume" : "cancel")}
                >
                  {busy === "cancel" ? "Canceling…" : busy === "resume" ? "Resuming…" : data.subscription.cancelAtPeriodEnd ? "Resume renewal" : "Cancel renewal"}
                </Button>
              </div>
            )}
            {!data.entitlement.isComplimentary && data.subscription?.source === "trial" && data.subscription.status === "trialing" && (
              <div className="px-5 pb-5">
                <Button variant="danger" disabled={Boolean(busy)} onClick={() => void endTrial()}>
                  {busy === "end_trial" ? "Ending trial…" : "End trial and return to Free"}
                </Button>
              </div>
            )}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-3">
            {data.plans.map((plan) => {
              const isCurrent = !data.entitlement.isComplimentary && data.entitlement.planId === plan.id;
              return (
                <Panel key={plan.id} hover={false} tone={plan.id === "professional" ? "violet" : undefined}>
                  <PanelHeader eyebrow={plan.id === "free" ? "Start here" : "Monthly subscription"} title={plan.name} />
                  <div className="px-5 pb-5">
                    <div className="text-2xl font-semibold text-fg">
                      {plan.amountMinor === 0 ? "Free" : formatNaira(plan.amountMinor)}
                      {plan.amountMinor > 0 && <span className="ml-1 text-[12px] font-normal text-fg-3">/ month</span>}
                    </div>
                    <p className="mt-2 min-h-10 text-[12px] leading-relaxed text-fg-3">{plan.description}</p>
                    <ul className="mt-4 space-y-2 border-t hairline pt-4">
                      {Object.entries(plan.features).map(([key, value]) => (
                        <li key={key} className="flex items-start justify-between gap-3 text-[11.5px]">
                          <span className="text-fg-2">{FEATURE_LABELS[key] ?? key.replaceAll("_", " ")}</span>
                          <span className={value === false ? "text-fg-4" : "text-fg"}>
                            {typeof value === "boolean" ? (value ? "Included" : "—") : value}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-5">
                      {isCurrent || data.entitlement.isComplimentary && plan.id === "professional" ? (
                        <Button disabled className="w-full">{data.entitlement.isComplimentary ? "Complimentary access" : "Current plan"}</Button>
                      ) : plan.id === "free" ? (
                        <Button disabled className="w-full">Included</Button>
                      ) : (
                        <div className="grid gap-2">
                          <Button
                            variant="primary"
                            disabled={Boolean(busy) || !data.checkoutAvailable}
                            onClick={() => void begin("checkout", plan.id)}
                            className="w-full"
                          >
                            {busy === `checkout:${plan.id}` ? "Connecting to Paystack…" : data.checkoutAvailable ? "Subscribe with Paystack" : "Paystack setup required"}
                          </Button>
                          {data.trialAvailable && plan.trialDays > 0 && (
                            <Button disabled={Boolean(busy)} onClick={() => void begin("trial", plan.id)} className="w-full">
                              {busy === `trial:${plan.id}` ? "Starting trial…" : `${plan.trialDays}-day trial`}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>

          <Panel hover={false} className="mt-5">
            <PanelHeader eyebrow="Receipts" title="Payment history" />
            {data.payments.length === 0 ? (
              <p className="px-5 pb-5 text-[12px] text-fg-3">No payments have been recorded for this account.</p>
            ) : (
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full min-w-[600px] text-left text-[11.5px]">
                  <thead className="text-fg-4"><tr><th className="py-2">Date</th><th>Plan</th><th>Reference</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {data.payments.map((payment) => (
                      <tr key={payment.reference}>
                        <td className="py-2.5 text-fg-3">{formatDate(payment.paidAt)}</td>
                        <td>{payment.planId}</td>
                        <td className="num text-fg-3">{payment.reference}</td>
                        <td>{formatNaira(payment.amountMinor)}</td>
                        <td><Badge tone={payment.status === "success" ? "emerald" : payment.status === "failed" ? "crimson" : "amber"}>{payment.status}</Badge></td>
                        <td>{payment.receiptUrl && payment.status === "success" ? <a href={payment.receiptUrl} className="text-[#9db8f5] hover:underline">View</a> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </>
  );
}
