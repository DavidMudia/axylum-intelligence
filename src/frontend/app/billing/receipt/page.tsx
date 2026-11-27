"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, PageHeader, Panel, PanelHeader } from "@/components/glass";

type Receipt = {
  reference: string;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
  status: string;
  planName: string;
};

function amount(value: number, currency: string): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100);
}

export default function ReceiptPage() {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const reference = new URLSearchParams(window.location.search).get("reference");
      if (!reference) {
        setError("Receipt reference is missing.");
        return;
      }
      void fetch(`/api/billing/receipt?reference=${encodeURIComponent(reference)}`, { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json() as { receipt?: Receipt; error?: string };
          if (!response.ok || !body.receipt) throw new Error(body.error ?? "Unable to load receipt");
          setReceipt(body.receipt);
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Payment receipt"
        description="A receipt is available only after the payment has been verified by Paystack."
        actions={<Button onClick={() => window.print()} disabled={!receipt}>Print receipt</Button>}
      />
      {error && <div role="alert" className="rounded-lg border border-down/30 bg-down/10 px-4 py-3 text-[12px] text-[#ec8696]">{error}</div>}
      {!receipt && !error && <p className="text-[13px] text-fg-3">Loading verified receipt…</p>}
      {receipt && (
        <Panel hover={false} className="max-w-2xl">
          <PanelHeader eyebrow="Axylum Intelligence" title="Subscription payment receipt" />
          <dl className="grid gap-3 px-5 pb-5 text-[12px] sm:grid-cols-2">
            <dt className="text-fg-3">Plan</dt><dd>{receipt.planName}</dd>
            <dt className="text-fg-3">Amount</dt><dd>{amount(receipt.amountMinor, receipt.currency)}</dd>
            <dt className="text-fg-3">Status</dt><dd className="text-[#6fd6ad]">Verified payment</dd>
            <dt className="text-fg-3">Paid at</dt><dd>{receipt.paidAt ? new Date(receipt.paidAt).toLocaleString() : "—"}</dd>
            <dt className="text-fg-3">Reference</dt><dd className="num break-all">{receipt.reference}</dd>
          </dl>
        </Panel>
      )}
      <Link href="/billing" className="mt-4 inline-block text-[12px] text-[#9db8f5] hover:underline">Back to billing</Link>
    </>
  );
}
