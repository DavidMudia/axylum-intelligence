"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Sparkline } from "@/components/charts/LineChart";
import { Badge, PageHeader, Panel, PanelHeader } from "@/components/glass";
import { MarketChart } from "@/features/markets/MarketChart";
import { cn } from "@/lib/format";
import { assetIntel, EVIDENCE, PREDICTION, sentimentSeries } from "@backend/lib/intel";
import { getAsset } from "@backend/lib/market";

function EvidenceList({ title, tone, items }: { title: string; tone: "crimson" | "emerald"; items: typeof EVIDENCE }) {
  return (
    <Panel hover={false} tone={tone}>
      <PanelHeader eyebrow={title} title={`${items.length} item${items.length === 1 ? "" : "s"}`} />
      <div className="space-y-3 px-5 pb-5">
        {items.map((e) => (
          <div key={e.id} className="rounded-[10px] border border-white/8 bg-black/25 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[12.5px] leading-snug text-fg">{e.title}</div>
              <span className={cn("num text-[12px]", e.contribution >= 0 ? "text-up" : "text-down")}>
                {e.contribution >= 0 ? "+" : "−"}
                {Math.abs(e.contribution).toFixed(2)}
              </span>
            </div>
            <div className="mt-1.5 text-[11px] text-fg-3">
              {e.source} · <span className="num">{e.timestamp}</span> · reliability <span className="num">{e.reliability.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function Investigation() {
  const asset = getAsset("BTC");
  const intel = assetIntel("BTC");
  const s = sentimentSeries("BTC");

  return (
    <>
      <Link href="/intelligence#evidence" className="mb-4 inline-flex items-center gap-1.5 text-[12px] text-fg-3 hover:text-fg">
        <ArrowLeft size={13} /> Evidence explorer
      </Link>
      <PageHeader
        eyebrow={`Investigation · ${PREDICTION.id}`}
        title="Why does the system believe this?"
        description={`${PREDICTION.asset} · ${PREDICTION.horizon} horizon · ${PREDICTION.model} ${PREDICTION.version} · generated ${PREDICTION.generatedAt}`}
        actions={
          <>
            <Badge tone="crimson" dot>
              {PREDICTION.stance} · {PREDICTION.strength}/100
            </Badge>
            <Badge tone="amber" dot>
              {PREDICTION.decision}
            </Badge>
          </>
        }
      />

      <MarketChart asset={asset} height={340} />

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <EvidenceList title="Supporting the forecast" tone="crimson" items={EVIDENCE.filter((e) => e.stance === "supports")} />
        <EvidenceList title="Contradicting the forecast" tone="emerald" items={EVIDENCE.filter((e) => e.stance === "contradicts")} />
        <Panel hover={false} tone="violet">
          <PanelHeader eyebrow="Context" title="Signals around the prediction" />
          <div className="space-y-5 px-5 pb-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-[12px]">
                <span className="text-fg-2">Social sentiment · 48h</span>
                <span className="num text-down">−0.34</span>
              </div>
              <Sparkline data={s.map((d) => d.social)} color="#9585f2" width={260} height={36} />
            </div>
            <div>
              <div className="eyebrow mb-1">On-chain</div>
              {intel.onchain.slice(0, 3).map((m) => (
                <div key={m.label} className="flex justify-between py-1.5 text-[12.5px]">
                  <span className="text-fg-3">{m.label}</span>
                  <span className={cn("num", m.tone === "neg" ? "text-down" : m.tone === "pos" ? "text-up" : "text-fg")}>{m.value}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="eyebrow mb-2">Knowledge graph</div>
              <div className="space-y-2">
                {intel.relations.slice(0, 3).map((r) => (
                  <div key={r.rel} className="flex items-center justify-between text-[12.5px]">
                    <span className="text-fg-2">
                      <span className="num text-[11px] text-[#b9aef7]">{r.rel}</span> {r.target}
                    </span>
                    <Badge tone={r.status === "verified" ? "emerald" : "amber"}>{r.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
