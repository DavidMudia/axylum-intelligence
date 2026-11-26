"use client";

import { useMemo, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { Badge, Bar, PageHeader, Panel, PanelHeader, Segmented, Tabs } from "@/components/glass";
import { cn } from "@/lib/format";
import { CALIBRATION, FEATURES, MODELS, predictionHistory, REGIMES } from "@backend/lib/ops";

type Tab = "performance" | "features" | "explorer" | "versions";

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className={cn("num mt-2 text-[22px] font-medium text-fg", tone)}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-fg-3">{sub}</div>}
    </div>
  );
}

function Performance() {
  const [id, setId] = useState(MODELS[0].id);
  const m = MODELS.find((x) => x.id === id)!;
  return (
    <div className="space-y-5">
      <Segmented value={id} onChange={setId} options={MODELS.map((x) => ({ key: x.id, label: x.id }))} />
      <Panel hover={false} className="grid grid-cols-2 divide-x divide-white/[0.06] md:grid-cols-5">
        <Metric label="Directional accuracy" value={`${(m.accuracy * 100).toFixed(1)}%`} sub="Out-of-sample, walk-forward" />
        <Metric label="Precision" value={m.precision.toFixed(2)} sub="Positive calls" />
        <Metric label="Recall" value={m.recall.toFixed(2)} sub="Positive moves caught" />
        <Metric label="Brier score" value={m.brier.toFixed(3)} sub={`Baseline ${m.baselineBrier.toFixed(3)} · lower is better`} tone={m.brier < m.baselineBrier ? "text-up" : "text-warn"} />
        <Metric label="Profit factor" value={m.profitFactor.toFixed(2)} sub="After fees and slippage" tone={m.profitFactor > 1 ? "text-up" : "text-down"} />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-5">
        <Panel hover={false} className="lg:col-span-3">
          <PanelHeader eyebrow="Calibration" title="Predicted probability vs observed frequency" />
          <div className="px-3 pb-2">
            <LineChart
              height={260}
              domain={[0, 1]}
              series={[
                { data: CALIBRATION.map((c) => c[0]), color: "rgba(163,171,187,0.6)", dashed: true, label: "Ideal" },
                { data: CALIBRATION.map((c) => c[1]), color: "#9585f2", area: true, label: "Observed" },
              ]}
              yFormat={(v) => v.toFixed(1)}
              xLabels={(i) => `p=${(CALIBRATION[i][0]).toFixed(1)}`}
            />
          </div>
          <p className="border-t hairline px-5 py-3 text-[11.5px] leading-relaxed text-fg-3">
            High-confidence predictions are over-stated: when the model says 80%, the observed frequency is closer to 66%. A model output is not a calibrated probability.
          </p>
        </Panel>
        <Panel hover={false} className="lg:col-span-2">
          <PanelHeader eyebrow="Performance by regime" title="Directional accuracy" />
          <div className="space-y-4 px-5 pb-5">
            {REGIMES.map((r) => (
              <div key={r.name}>
                <div className="mb-1.5 flex justify-between text-[12.5px]">
                  <span className="text-fg-2">{r.name}</span>
                  <span className="num text-fg">
                    {(r.accuracy * 100).toFixed(0)}% <span className="text-fg-3">· n={r.n}</span>
                  </span>
                </div>
                <Bar value={((r.accuracy - 0.4) / 0.3) * 100} tone={r.accuracy >= 0.55 ? "emerald" : r.accuracy < 0.52 ? "amber" : "blue"} />
              </div>
            ))}
            <p className="pt-1 text-[11.5px] leading-relaxed text-fg-3">A single headline accuracy hides regime dependence. Bars scaled from 40% to 70%.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Features() {
  const max = FEATURES[0].value;
  return (
    <Panel hover={false} tone="violet">
      <PanelHeader eyebrow="Feature importance" title="What is influencing the BTC 4-hour prediction?" />
      <div className="space-y-4 px-5 pb-6 pt-1">
        {FEATURES.map((f, i) => (
          <div key={f.name} className="grid grid-cols-[28px_200px_1fr_52px] items-center gap-4 text-[12.5px]">
            <span className="num text-fg-3">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-fg-2">{f.name}</span>
            <Bar value={(f.value / max) * 100} tone="violet" />
            <span className="num text-right text-fg">{(f.value * 100).toFixed(0)}%</span>
          </div>
        ))}
        <p className="pt-2 text-[11.5px] text-fg-3">Normalised gain importance for xgb-btc-4h v0.7.2. Importance describes model behaviour, not causality.</p>
      </div>
    </Panel>
  );
}

function Explorer() {
  const [model, setModel] = useState(MODELS[0].id);
  const [h, setH] = useState("4h");
  const rows = useMemo(() => predictionHistory(14), []);
  const hit = rows.filter((r) => (r.p > 0.5) === (r.ret > 0)).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={model} onChange={setModel} options={MODELS.map((x) => ({ key: x.id, label: x.id }))} />
        <Segmented value={h} onChange={setH} options={["15m", "1h", "4h", "24h"].map((k) => ({ key: k, label: k }))} />
      </div>
      <Panel hover={false}>
        <PanelHeader eyebrow="Prediction explorer" title={`Predictions against outcomes · ${hit}/${rows.length} correct direction`} />
        <table className="num w-full text-[12.5px]">
          <thead>
            <tr className="border-y hairline text-left text-fg-3">
              <th className="px-5 py-2.5 font-normal">#</th>
              <th className="py-2.5 font-normal">P(up)</th>
              <th className="py-2.5 font-normal">Call</th>
              <th className="py-2.5 font-normal">Actual return</th>
              <th className="px-5 py-2.5 text-right font-normal">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ok = (r.p > 0.5) === (r.ret > 0);
              return (
                <tr key={r.i} className="border-b hairline last:border-0">
                  <td className="px-5 py-2.5 text-fg-3">{String(r.i + 1).padStart(2, "0")}</td>
                  <td className="py-2.5 text-fg">{(r.p * 100).toFixed(0)}%</td>
                  <td className={cn("py-2.5", r.p > 0.5 ? "text-up" : "text-down")}>{r.p > 0.5 ? "▲ Up" : "▼ Down"}</td>
                  <td className={cn("py-2.5", r.ret >= 0 ? "text-up" : "text-down")}>
                    {r.ret >= 0 ? "+" : "−"}
                    {Math.abs(r.ret).toFixed(2)}%
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <Badge tone={ok ? "emerald" : "crimson"}>{ok ? "Correct" : "Incorrect"}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-5 py-3 text-[11px] text-fg-3">Illustrative history for the selected model ({model}) at {h} horizon.</p>
      </Panel>
    </div>
  );
}

function Versions() {
  return (
    <Panel hover={false}>
      <PanelHeader eyebrow="Model registry" title="Versions, training data and evaluation" />
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-y hairline text-left text-fg-3">
              {["Model", "Algorithm", "Version", "Training window", "Last evaluated", "Status"].map((h) => (
                <th key={h} className="px-5 py-2.5 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODELS.map((m) => (
              <tr key={m.id} className="border-b hairline last:border-0">
                <td className="num px-5 py-3 text-fg">{m.id}</td>
                <td className="px-5 py-3 text-fg-2">{m.algo}</td>
                <td className="num px-5 py-3 text-fg-2">{m.version}</td>
                <td className="num px-5 py-3 text-fg-2">{m.trainedOn}</td>
                <td className="px-5 py-3 text-fg-2">{m.evaluated}</td>
                <td className="px-5 py-3">
                  <Badge tone={m.status === "Serving" ? "emerald" : "violet"} dot>
                    {m.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t hairline px-5 py-3 text-[11.5px] text-fg-3">Models are never retrained and deployed automatically. New versions require validation, versioning and approval.</p>
    </Panel>
  );
}

export default function Models() {
  const [tab, setTab] = useState<Tab>("performance");
  return (
    <>
      <PageHeader
        eyebrow="Prediction laboratory"
        title="Models"
        description="Understand and evaluate forecasting models beyond a single accuracy figure."
      />
      <div className="mb-6">
        <Tabs
          id="models"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "performance", label: "Performance" },
            { key: "features", label: "Feature importance" },
            { key: "explorer", label: "Prediction explorer" },
            { key: "versions", label: "Versions" },
          ]}
        />
      </div>
      {tab === "performance" && <Performance />}
      {tab === "features" && <Features />}
      {tab === "explorer" && <Explorer />}
      {tab === "versions" && <Versions />}
    </>
  );
}
