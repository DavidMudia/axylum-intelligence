"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Sparkline } from "@/components/charts/LineChart";
import { Badge, Bar, PageHeader, Panel, PanelHeader, StatusDot } from "@/components/glass";
import { cn, fmtCompact } from "@/lib/format";
import { PIPELINE, SOURCES } from "@backend/lib/ops";

function Pipeline() {
  const [sel, setSel] = useState("validator");
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % PIPELINE.length), 1300);
    return () => clearInterval(t);
  }, []);
  const stage = PIPELINE.find((s) => s.key === sel)!;

  return (
    <Panel hover={false} tone="blue">
      <PanelHeader eyebrow="Ingestion pipeline" title="Source → Collector → Normalizer → Validator → Storage → Intelligence" />
      <div className="flex items-stretch gap-0 overflow-x-auto px-5 pb-5 pt-2">
        {PIPELINE.map((s, i) => (
          <div key={s.key} className="flex flex-1 items-center">
            <button
              onClick={() => setSel(s.key)}
              aria-pressed={sel === s.key}
              className={cn(
                "min-w-[120px] flex-1 rounded-[12px] border px-4 py-3.5 text-left transition-colors",
                sel === s.key ? "border-accent/50 bg-accent/10" : "border-white/10 bg-black/20 hover:border-white/20",
                active === i && "anim-stage",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-fg">{s.label}</span>
                {s.errors > 0 ? <span className="num text-[10.5px] text-warn">{s.errors} err</span> : <StatusDot status="ok" />}
              </div>
              <div className="num mt-2 text-[11px] text-fg-3">{s.count}</div>
              <div className="num text-[11px] text-fg-3">{s.throughput}</div>
            </button>
            {i < PIPELINE.length - 1 && (
              <svg width="28" height="12" className="shrink-0" aria-hidden>
                <line x1="2" x2="26" y1="6" y2="6" stroke={active === i ? "#5b8def" : "rgba(255,255,255,0.18)"} strokeWidth="1.3" className={active === i ? "anim-flow" : ""} />
                <path d="M22 2.5 26 6 22 9.5" fill="none" stroke={active === i ? "#5b8def" : "rgba(255,255,255,0.18)"} strokeWidth="1.3" />
              </svg>
            )}
          </div>
        ))}
      </div>
      <div className="grid gap-6 border-t hairline px-5 py-5 lg:grid-cols-2">
        <div>
          <div className="eyebrow">{stage.label}</div>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-2">{stage.detail}</p>
          <div className="mt-4 flex gap-8">
            <div>
              <div className="eyebrow">Throughput</div>
              <div className="num mt-1 text-[14px] text-fg">{stage.throughput}</div>
            </div>
            <div>
              <div className="eyebrow">Errors · 1h</div>
              <div className={cn("num mt-1 text-[14px]", stage.errors ? "text-warn" : "text-fg")}>{stage.errors}</div>
            </div>
          </div>
        </div>
        <div>
          <div className="eyebrow mb-2">Recent log</div>
          <div className="space-y-1.5 rounded-[10px] border hairline bg-black/35 p-3">
            {stage.log.map((l) => (
              <div key={l} className="num text-[11.5px] text-fg-2">
                <span className="text-fg-4">›</span> {l}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

export default function DataSources() {
  return (
    <>
      <PageHeader
        eyebrow="Data sources"
        title="Collection and pipeline monitoring"
        description="Every piece of information entering the system, where it came from and how healthy the path is. Connectors shown are proposed integrations, not confirmed account connections."
      />
      <Pipeline />
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {SOURCES.map((s, i) => (
          <Panel key={s.id} delay={i * 50} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[14px] font-medium text-fg">{s.name}</div>
                <div className="mt-0.5 text-[11.5px] text-fg-3">{s.info}</div>
              </div>
              <Badge tone={s.status === "Connected" ? "emerald" : "amber"} dot>
                {s.status}
              </Badge>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <div className="eyebrow">Requests · 24h</div>
                <div className="num mt-1 text-[20px] font-medium text-fg">{fmtCompact(s.requests)}</div>
              </div>
              <Sparkline data={s.spark} color={s.status === "Connected" ? "#5b8def" : "#d6a24a"} width={110} height={34} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 border-t hairline pt-4">
              {[
                ["Last success", s.lastSuccess],
                ["Error rate", `${s.errorRate}%`],
                ["Freshness", s.freshness >= 60 ? `${Math.round(s.freshness / 60)}m` : `${s.freshness}s`],
                ["Latency", `${s.latency}ms`],
                ["Channel", s.channel],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10.5px] text-fg-3">{k}</div>
                  <div className={cn("num mt-0.5 text-[12.5px] text-fg", k === "Error rate" && s.errorRate > 2 && "text-warn")}>{v}</div>
                </div>
              ))}
              <div>
                <div className="flex justify-between text-[10.5px] text-fg-3">
                  <span>Rate limit</span>
                  <span className="num">{s.rateLimit}%</span>
                </div>
                <Bar value={s.rateLimit} tone={s.rateLimit > 80 ? "amber" : "blue"} className="mt-2" />
              </div>
            </div>
          </Panel>
        ))}
        <Panel className="grid place-items-center p-5 text-center" hover={false}>
          <div>
            <ChevronRight className="mx-auto mb-2 text-fg-4" size={18} />
            <div className="text-[12.5px] text-fg-3">Credentials are held server-side.</div>
            <div className="text-[12.5px] text-fg-3">The interface never receives secrets.</div>
          </div>
        </Panel>
      </div>
    </>
  );
}
