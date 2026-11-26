"use client";

import { Badge, PageHeader, Panel, PanelHeader, Row } from "@/components/glass";
import { cn } from "@/lib/format";
import { ASSETS } from "@backend/lib/market";
import { useUI } from "@/stores/ui";

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onChange} className={cn("relative h-5 w-9 rounded-full border transition-colors", on ? "border-accent/50 bg-accent/40" : "border-white/15 bg-white/[0.06]")}>
      <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-fg transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

const LAYERS = [
  ["1", "Data acquisition", "Exchange APIs · news · social · blockchain · macro"],
  ["2", "Processing and normalisation", "Cleaning · validation · deduplication · timestamps"],
  ["3", "Semantic knowledge", "RDF · ontologies · entity relationships"],
  ["4", "Intelligence and prediction", "NLP · sentiment · forecasting"],
  ["5", "Decision engine", "Signals · evidence · strategy rules"],
  ["6", "Risk and execution", "Sizing · limits · paper execution"],
  ["7", "Monitoring and learning", "Dashboard · evaluation · audit"],
];

export default function Settings() {
  const { collapsed, toggleCollapsed, streamOpen, setStreamOpen, asset, setAsset, system } = useUI();
  return (
    <>
      <PageHeader eyebrow="Settings" title="Application configuration" description="Interface preferences and system architecture reference." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel hover={false}>
          <PanelHeader eyebrow="Interface" title="Workspace" />
          <div className="divide-y divide-white/[0.06] px-5 pb-4">
            <Row label="Compact navigation rail">
              <Toggle on={collapsed} onChange={toggleCollapsed} label="Compact navigation" />
            </Row>
            <Row label="Persistent activity stream">
              <Toggle on={streamOpen} onChange={() => setStreamOpen(!streamOpen)} label="Activity stream" />
            </Row>
            <Row label="Default asset">
              <select value={asset} onChange={(e) => setAsset(e.target.value)} className="rounded-lg border hairline bg-black/30 px-2.5 py-1.5 text-[12.5px] text-fg outline-none">
                {ASSETS.map((a) => (
                  <option key={a.symbol}>{a.symbol}</option>
                ))}
              </select>
            </Row>
            <Row label="Motion">
              <span className="text-[12px] text-fg-3">Follows system “reduce motion”</span>
            </Row>
            <Row label="Command palette">
              <kbd className="num rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-fg-2">Ctrl K</kbd>
            </Row>
          </div>
        </Panel>
        <Panel hover={false}>
          <PanelHeader eyebrow="System" title="Operating profile" />
          <div className="divide-y divide-white/[0.06] px-5 pb-4">
            <Row label="Operating mode">
              <Badge tone={system.mode === "paper" ? "blue" : "crimson"} dot>
                {system.mode === "paper" ? "Paper trading" : "Live"}
              </Badge>
            </Row>
            <Row label="Emergency shutdown">
              <Badge tone={system.killSwitch ? "crimson" : "emerald"} dot>
                {system.killSwitch ? "Active" : "Inactive"}
              </Badge>
            </Row>
            <Row label="Primary market">
              <span className="num">BTC/USDT spot</span>
            </Row>
            <Row label="Forecast horizons">
              <span className="num">15m · 1h · 4h · 24h</span>
            </Row>
            <Row label="Leverage">
              <span className="num">None</span>
            </Row>
          </div>
        </Panel>
        <Panel hover={false} className="lg:col-span-2" tone="violet">
          <PanelHeader eyebrow="Architecture" title="Seven-layer intelligence system" />
          <div className="grid gap-px px-5 pb-5 md:grid-cols-2">
            {LAYERS.map(([n, t, d]) => (
              <div key={n} className="flex gap-4 py-2.5">
                <span className="num text-[12px] text-[#b9aef7]">{n.padStart(2, "0")}</span>
                <div>
                  <div className="text-[13px] text-fg">{t}</div>
                  <div className="text-[11.5px] text-fg-3">{d}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
