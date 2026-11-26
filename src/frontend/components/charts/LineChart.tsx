"use client";

import { useId, useState } from "react";
import { useSize } from "@/hooks/useSize";

export type Series = { data: number[]; color: string; dashed?: boolean; area?: boolean; label?: string };

export function LineChart({
  series,
  height = 180,
  domain,
  zero,
  yFormat = (v: number) => v.toFixed(2),
  xLabels,
  grid = 4,
}: {
  series: Series[];
  height?: number;
  domain?: [number, number];
  zero?: boolean;
  yFormat?: (v: number) => string;
  xLabels?: (i: number) => string;
  grid?: number;
}) {
  const { ref, width } = useSize<HTMLDivElement>();
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 44;
  const padR = 8;
  const padB = xLabels ? 20 : 4;
  const all = series.flatMap((s) => s.data);
  let lo = domain ? domain[0] : Math.min(...all);
  let hi = domain ? domain[1] : Math.max(...all);
  if (!domain) {
    const p = (hi - lo) * 0.08 || 1;
    lo -= p;
    hi += p;
  }
  const n = series[0]?.data.length ?? 0;
  const w = Math.max(width - padL - padR, 10);
  const ih = height - padB - 6;
  const x = (i: number) => padL + (i / Math.max(n - 1, 1)) * w;
  const y = (v: number) => 4 + ((hi - v) / (hi - lo)) * ih;
  const d = (data: number[]) => data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left - padL) / w) * (n - 1));
            setHover(i >= 0 && i < n ? i : null);
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            {series.map((s, k) => (
              <linearGradient key={k} id={`${id}-g${k}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {Array.from({ length: grid + 1 }, (_, i) => {
            const v = lo + ((hi - lo) * i) / grid;
            return (
              <g key={i}>
                <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.05)" />
                <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" className="num" fill="#6b7385">
                  {yFormat(v)}
                </text>
              </g>
            );
          })}
          {zero && lo < 0 && hi > 0 && <line x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 4" />}
          {series.map((s, k) => (
            <g key={k}>
              {s.area && <path d={`${d(s.data)}L${x(n - 1)},${y(lo)}L${x(0)},${y(lo)}Z`} fill={`url(#${id}-g${k})`} />}
              <path d={d(s.data)} fill="none" stroke={s.color} strokeWidth="1.5" strokeDasharray={s.dashed ? "4 4" : undefined} strokeLinejoin="round" />
            </g>
          ))}
          {xLabels &&
            Array.from({ length: 6 }, (_, k) => {
              const i = Math.round((k / 5) * (n - 1));
              return (
                <text key={k} x={x(i)} y={height - 4} textAnchor="middle" fontSize="10.5" className="num" fill="#6b7385">
                  {xLabels(i)}
                </text>
              );
            })}
          {hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={4} y2={ih + 4} stroke="rgba(255,255,255,0.22)" strokeDasharray="3 3" />
              {series.map((s, k) => (
                <circle key={k} cx={x(hover)} cy={y(s.data[hover])} r={3} fill={s.color} stroke="#0b0e14" strokeWidth="1.5" />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover != null && (
        <div
          className="glass-solid pointer-events-none absolute top-1 z-10 px-2.5 py-1.5 text-[11px]"
          style={{ left: Math.min(Math.max(x(hover) + 10, padL), Math.max(width - 150, padL)), background: "rgba(10,12,18,0.92)" }}
        >
          {xLabels && <div className="num mb-0.5 text-[10px] text-fg-3">{xLabels(hover)}</div>}
          {series.map((s, k) => (
            <div key={k} className="num flex items-center gap-2 text-fg">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.label && <span className="text-fg-3">{s.label}</span>}
              {yFormat(s.data[hover])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ data, color = "#5b8def", width = 96, height = 28, area = true }: { data: number[]; color?: string; width?: number; height?: number; area?: boolean }) {
  const id = useId();
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => 2 + ((hi - v) / (hi - lo || 1)) * (height - 4);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
