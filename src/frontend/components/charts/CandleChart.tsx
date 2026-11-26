"use client";

import { useMemo, useState } from "react";
import { useSize } from "@/hooks/useSize";
import { cn, fmtCompact, fmtDateTime, fmtPrice } from "@/lib/format";
import { macd, rsi, sma, type Candle, type MarketEvent } from "@backend/lib/market";

export type Indicators = { volume: boolean; ma: boolean; rsi: boolean; macd: boolean; predictions: boolean; events: boolean };

type Marker = { index: number; up: boolean; p: number; outcome: "correct" | "incorrect" | "pending" };

function markers(candles: Candle[]): Marker[] {
  const out: Marker[] = [];
  const n = candles.length;
  for (let i = 30; i < n - 5; i += 13) {
    const up = (i * 7 + candles[i].t / 3600000) % 3 > 1;
    const p = 0.56 + ((i * 13) % 17) / 100;
    const move = candles[i + 4].c - candles[i].c;
    out.push({ index: i, up, p, outcome: (move > 0) === up ? "correct" : "incorrect" });
  }
  const m20 = sma(candles.map((c) => c.c), 20)[n - 1];
  out.push({ index: n - 1, up: m20 ? candles[n - 1].c > m20 : true, p: 0.58, outcome: "pending" });
  return out;
}

export function CandleChart({
  candles,
  events,
  indicators,
  visible = 96,
  height = 360,
}: {
  candles: Candle[];
  events: MarketEvent[];
  indicators: Indicators;
  visible?: number;
  height?: number;
}) {
  const { ref, width } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = candles.length;
  const closes = useMemo(() => candles.map((c) => c.c), [candles]);
  const ma20 = useMemo(() => sma(closes, 20), [closes]);
  const ma50 = useMemo(() => sma(closes, 50), [closes]);
  const rsiV = useMemo(() => rsi(closes), [closes]);
  const macdV = useMemo(() => macd(closes), [closes]);
  const preds = useMemo(() => markers(candles), [candles]);

  const count = Math.min(visible, n);
  const start = n - count;
  const padL = 4;
  const padR = 64;
  const axisH = 24;
  const gap = 10;
  const hR = indicators.rsi ? 84 : 0;
  const hM = indicators.macd ? 84 : 0;
  const total = height + (hR ? gap + hR : 0) + (hM ? gap + hM : 0) + axisH;
  const innerW = Math.max(width - padL - padR, 10);
  const bw = innerW / count;
  const x = (i: number) => padL + (i - start + 0.5) * bw;

  const vis = candles.slice(start);
  let lo = Math.min(...vis.map((c) => c.l));
  let hi = Math.max(...vis.map((c) => c.h));
  const padY = (hi - lo) * 0.08;
  lo -= padY;
  hi += padY + (hi - lo) * 0.06;
  const volMax = Math.max(...vis.map((c) => c.v));
  const yP = (p: number) => ((hi - p) / (hi - lo)) * height;
  const yVol = (v: number) => height - (v / volMax) * height * 0.18;

  const last = candles[n - 1];
  const up = last.c >= candles[n - 2].c;

  const path = (arr: Array<number | null>) => {
    let d = "";
    for (let i = start; i < n; i++) {
      const v = arr[i];
      if (v == null) continue;
      d += `${d ? "L" : "M"}${x(i).toFixed(1)},${yP(v).toFixed(1)}`;
    }
    return d;
  };

  const rsiTop = height + gap;
  const macdTop = height + (hR ? gap + hR : 0) + gap;
  const axisTop = total - axisH;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - rect.left - padL) / bw - 0.5) + start;
    setHover(i >= start && i < n ? i : null);
  };

  const h = hover;
  const hc = h != null ? candles[h] : null;
  const nearEvent = h != null && indicators.events ? events.find((e) => Math.abs(e.index - h) <= 1) : undefined;
  const nearPred = h != null && indicators.predictions ? preds.find((p) => p.index === h) : undefined;

  const gridPrices = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 5);
  const tickEvery = Math.max(1, Math.round(count / 7));

  const macdMax = Math.max(...macdV.hist.slice(start).map(Math.abs), ...macdV.line.slice(start).map(Math.abs)) || 1;
  const yM = (v: number) => macdTop + hM / 2 - (v / macdMax) * (hM / 2 - 6);

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height: total }}>
      {width > 0 && (
      <svg
        width={width}
        height={total}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="block cursor-crosshair"
        style={{ touchAction: "pan-y" }}
      >
          {/* grid */}
          {gridPrices.map((p) => (
            <g key={p}>
              <line x1={padL} x2={width - padR} y1={yP(p)} y2={yP(p)} stroke="rgba(255,255,255,0.045)" />
              <text x={width - padR + 8} y={yP(p) + 3.5} fontSize="10.5" className="num" fill="#6b7385">
                {fmtPrice(p, p > 1000 ? 0 : 2)}
              </text>
            </g>
          ))}

          {/* volume */}
          {indicators.volume &&
            vis.map((c, k) => (
              <rect
                key={c.t}
                x={x(start + k) - bw * 0.36}
                y={yVol(c.v)}
                width={bw * 0.72}
                height={height - yVol(c.v)}
                fill={c.c >= c.o ? "rgba(63,191,143,0.16)" : "rgba(217,89,108,0.16)"}
              />
            ))}

          {/* events */}
          {indicators.events &&
            events
              .filter((e) => e.index >= start)
              .map((e) => {
                const c = candles[e.index];
                const color = e.tone === "neg" ? "#d9596c" : e.tone === "pos" ? "#3fbf8f" : "#d6a24a";
                return (
                  <g key={e.index}>
                    <line x1={x(e.index)} x2={x(e.index)} y1={22} y2={yP(c.h) - 4} stroke="#9585f2" strokeOpacity="0.45" strokeDasharray="2 4" />
                    <rect x={x(e.index) - 8} y={8} width={16} height={16} rx={5} fill="rgba(149,133,242,0.18)" stroke="rgba(149,133,242,0.6)" />
                    <circle cx={x(e.index)} cy={16} r={2.4} fill={color} />
                  </g>
                );
              })}

          {/* moving averages */}
          {indicators.ma && (
            <>
              <path d={path(ma50)} fill="none" stroke="#9585f2" strokeWidth="1.2" strokeOpacity="0.9" />
              <path d={path(ma20)} fill="none" stroke="#5b8def" strokeWidth="1.2" strokeOpacity="0.95" />
            </>
          )}

          {/* candles */}
          {vis.map((c, k) => {
            const i = start + k;
            const col = c.c >= c.o ? "#3fbf8f" : "#d9596c";
            const bodyTop = yP(Math.max(c.o, c.c));
            const bodyH = Math.max(Math.abs(yP(c.o) - yP(c.c)), 1);
            return (
              <g key={c.t} opacity={h != null && h !== i ? 0.88 : 1}>
                <line x1={x(i)} x2={x(i)} y1={yP(c.h)} y2={yP(c.l)} stroke={col} strokeWidth="1" />
                <rect x={x(i) - bw * 0.34} y={bodyTop} width={bw * 0.68} height={bodyH} fill={col} rx={0.8} />
              </g>
            );
          })}

          {/* prediction markers */}
          {indicators.predictions &&
            preds
              .filter((p) => p.index >= start)
              .map((p) => {
                const c = candles[p.index];
                const cx = x(p.index);
                const cy = yP(c.l) + 14;
                const col = p.outcome === "pending" ? "#9585f2" : p.outcome === "correct" ? "#3fbf8f" : "#d9596c";
                const pts = p.up ? `${cx},${cy - 5} ${cx - 5},${cy + 4} ${cx + 5},${cy + 4}` : `${cx},${cy + 5} ${cx - 5},${cy - 4} ${cx + 5},${cy - 4}`;
                return (
                  <polygon
                    key={p.index}
                    points={pts}
                    fill={p.outcome === "pending" ? "none" : col}
                    stroke={col}
                    strokeWidth="1.3"
                    fillOpacity="0.8"
                  />
                );
              })}

          {/* last price */}
          <line x1={padL} x2={width - padR} y1={yP(last.c)} y2={yP(last.c)} stroke={up ? "#3fbf8f" : "#d9596c"} strokeOpacity="0.55" strokeDasharray="3 4" />
          <rect x={width - padR + 2} y={yP(last.c) - 9} width={padR - 4} height={18} rx={4} fill={up ? "#2b8f6a" : "#a8445a"} />
          <text x={width - padR + 8} y={yP(last.c) + 3.5} fontSize="10.5" className="num" fill="#fff">
            {fmtPrice(last.c, last.c > 1000 ? 0 : 2)}
          </text>

          {/* RSI */}
          {indicators.rsi && (
            <g>
              <rect x={padL} y={rsiTop} width={innerW} height={hR} fill="rgba(255,255,255,0.015)" rx={6} />
              {[30, 70].map((lv) => (
                <g key={lv}>
                  <line x1={padL} x2={width - padR} y1={rsiTop + hR - (lv / 100) * hR} y2={rsiTop + hR - (lv / 100) * hR} stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
                  <text x={width - padR + 8} y={rsiTop + hR - (lv / 100) * hR + 3.5} fontSize="10" className="num" fill="#6b7385">
                    {lv}
                  </text>
                </g>
              ))}
              <path
                d={rsiV
                  .map((v, i) => (v == null || i < start ? "" : `${i === start || rsiV[i - 1] == null ? "M" : "L"}${x(i).toFixed(1)},${(rsiTop + hR - (v / 100) * hR).toFixed(1)}`))
                  .join("")}
                fill="none"
                stroke="#9db8f5"
                strokeWidth="1.2"
              />
              <text x={padL + 8} y={rsiTop + 14} fontSize="10" fill="#6b7385" className="num">
                RSI 14
              </text>
            </g>
          )}

          {/* MACD */}
          {indicators.macd && (
            <g>
              <rect x={padL} y={macdTop} width={innerW} height={hM} fill="rgba(255,255,255,0.015)" rx={6} />
              <line x1={padL} x2={width - padR} y1={yM(0)} y2={yM(0)} stroke="rgba(255,255,255,0.08)" />
              {macdV.hist.map((v, i) =>
                i < start ? null : (
                  <rect
                    key={i}
                    x={x(i) - bw * 0.3}
                    y={Math.min(yM(0), yM(v))}
                    width={bw * 0.6}
                    height={Math.abs(yM(v) - yM(0))}
                    fill={v >= 0 ? "rgba(63,191,143,0.4)" : "rgba(217,89,108,0.4)"}
                  />
                ),
              )}
              <path d={macdV.line.map((v, i) => (i < start ? "" : `${i === start ? "M" : "L"}${x(i).toFixed(1)},${yM(v).toFixed(1)}`)).join("")} fill="none" stroke="#5b8def" strokeWidth="1.1" />
              <path d={macdV.signal.map((v, i) => (i < start ? "" : `${i === start ? "M" : "L"}${x(i).toFixed(1)},${yM(v).toFixed(1)}`)).join("")} fill="none" stroke="#9585f2" strokeWidth="1.1" />
              <text x={padL + 8} y={macdTop + 14} fontSize="10" fill="#6b7385" className="num">
                MACD 12 26 9
              </text>
            </g>
          )}

          {/* time axis */}
          {vis.map((c, k) =>
            k % tickEvery === 0 ? (
              <text key={c.t} x={x(start + k)} y={axisTop + 16} fontSize="10.5" textAnchor="middle" className="num" fill="#6b7385">
                {new Date(c.t).toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", hour12: false, timeZone: "UTC" }).replace(",", "")}
              </text>
            ) : null,
          )}

          {/* crosshair */}
          {h != null && hc && (
            <g pointerEvents="none">
              <line x1={x(h)} x2={x(h)} y1={0} y2={axisTop} stroke="rgba(255,255,255,0.28)" strokeDasharray="3 3" />
              <line x1={padL} x2={width - padR} y1={yP(hc.c)} y2={yP(hc.c)} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
              <rect x={width - padR + 2} y={yP(hc.c) - 9} width={padR - 4} height={18} rx={4} fill="#2a3040" />
              <text x={width - padR + 8} y={yP(hc.c) + 3.5} fontSize="10.5" className="num" fill="#e8ebf2">
                {fmtPrice(hc.c, hc.c > 1000 ? 0 : 2)}
              </text>
            </g>
          )}
        </svg>
      )}

      {/* inspector */}
      {hc && h != null && (
        <div
          className="glass-solid pointer-events-none absolute left-3 top-9 z-10 w-[262px] p-3 text-[11.5px] shadow-xl"
          style={{ background: "rgba(10,12,18,0.9)" }}
        >
          <div className="num text-[10.5px] text-fg-3">{fmtDateTime(hc.t)} UTC</div>
          <div className="num mt-2 grid grid-cols-4 gap-1 text-fg-2">
            {(["o", "h", "l", "c"] as const).map((k) => (
              <div key={k}>
                <div className="text-[9.5px] uppercase text-fg-3">{k}</div>
                <div className="text-fg">{fmtPrice(hc[k], hc[k] > 1000 ? 0 : 2)}</div>
              </div>
            ))}
          </div>
          <div className="num mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-fg-3">
            <span>Vol {fmtCompact(hc.v)}</span>
            {ma20[h] != null && <span className="text-[#9db8f5]">MA20 {fmtPrice(ma20[h]!, 0)}</span>}
            {rsiV[h] != null && <span>RSI {rsiV[h]!.toFixed(0)}</span>}
          </div>
          {nearEvent && (
            <div className="mt-2.5 rounded-lg border border-violet/30 bg-violet/10 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-[#b9aef7]">{nearEvent.title}</span>
                <span className={cn("num", nearEvent.movePct >= 0 ? "text-up" : "text-down")}>
                  {nearEvent.movePct >= 0 ? "+" : "−"}
                  {Math.abs(nearEvent.movePct).toFixed(2)}%
                </span>
              </div>
              <p className="mt-1 leading-snug text-fg-2">
                Detected <span className="num text-fg">{nearEvent.leadMin} min</span> before this move. {nearEvent.detail}
              </p>
            </div>
          )}
          {nearPred && (
            <div className="mt-2.5 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-fg-2">
              4h forecast <span className="num text-fg">{nearPred.up ? "▲" : "▼"} {(nearPred.up ? nearPred.p : 1 - nearPred.p + 0.1).toFixed(2)}</span> ·{" "}
              <span className={nearPred.outcome === "correct" ? "text-up" : nearPred.outcome === "incorrect" ? "text-down" : "text-[#b9aef7]"}>{nearPred.outcome}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
