"use client";

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/format";

type Tone = "neutral" | "blue" | "violet" | "emerald" | "crimson" | "amber";

export function Panel({
  children,
  className,
  tone,
  hover = true,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  tone?: "blue" | "violet" | "emerald" | "crimson";
  hover?: boolean;
  delay?: number;
}) {
  return (
    <section
      className={cn("glass anim-rise", hover && "glass-hover", tone && `glass-${tone}`, className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-center justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        {title && <h3 className="mt-0.5 truncate text-[14px] font-medium text-fg">{title}</h3>}
      </div>
      {action}
    </header>
  );
}

const BADGE: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/[0.04] text-fg-2",
  blue: "border-accent/30 bg-accent/10 text-[#9db8f5]",
  violet: "border-violet/30 bg-violet/10 text-[#b9aef7]",
  emerald: "border-up/30 bg-up/10 text-[#6fd6ad]",
  crimson: "border-down/30 bg-down/10 text-[#ec8696]",
  amber: "border-warn/30 bg-warn/10 text-[#e3bd78]",
};

export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", BADGE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatusDot({ status, pulse }: { status: "ok" | "degraded" | "down" | "idle"; pulse?: boolean }) {
  const color = status === "ok" ? "text-up" : status === "degraded" ? "text-warn" : status === "down" ? "text-down" : "text-fg-3";
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full bg-current", color, pulse && status === "ok" && "anim-pulse")} />;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="anim-rise flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Delta({ value, digits = 2, className }: { value: number; digits?: number; className?: string }) {
  const up = value >= 0;
  return (
    <span className={cn("num", up ? "text-up" : "text-down", className)}>
      {up ? "+" : "−"}
      {Math.abs(value).toFixed(digits)}%
    </span>
  );
}

export function AnimatedNumber({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.6, ease: "easeOut" });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span className={cn("num", className)}>{text}</motion.span>;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  id,
}: {
  tabs: Array<{ key: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  id: string;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b hairline">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "relative px-3.5 pb-3 pt-1 text-[13px] font-medium transition-colors",
            value === t.key ? "text-fg" : "text-fg-3 hover:text-fg-2",
          )}
        >
          {t.label}
          {value === t.key && (
            <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-px bg-accent shadow-[0_0_8px_rgba(91,141,239,0.8)]" />
          )}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg border hairline bg-black/25 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-[11.5px]" : "px-3 py-1.5 text-[12.5px]",
            value === o.key ? "bg-white/[0.09] text-fg shadow-sm" : "text-fg-3 hover:text-fg-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-accent/90 text-white hover:bg-accent border-accent/40",
    ghost: "bg-white/[0.04] text-fg-2 hover:bg-white/[0.08] hover:text-fg border-white/10",
    danger: "bg-down/15 text-[#ec8696] hover:bg-down/25 border-down/30",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        styles,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Bar({ value, tone = "blue", className }: { value: number; tone?: "blue" | "violet" | "emerald" | "crimson" | "amber"; className?: string }) {
  const color = { blue: "bg-accent", violet: "bg-violet", emerald: "bg-up", crimson: "bg-down", amber: "bg-warn" }[tone];
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-white/[0.07]", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-700", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-2 text-[13px]", className)}>
      <span className="text-fg-3">{label}</span>
      <span className="text-fg">{children}</span>
    </div>
  );
}
