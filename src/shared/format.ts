export function fmtPrice(n: number, digits?: number) {
  const d = digits ?? (n >= 1000 ? 2 : n >= 10 ? 2 : 4);
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtCompact(n: number) {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function fmtPct(n: number, digits = 2) {
  const s = n >= 0 ? "+" : "−";
  return `${s}${Math.abs(n).toFixed(digits)}%`;
}

export function fmtUsd(n: number, digits = 2) {
  const s = n < 0 ? "−" : "";
  return `${s}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function fmtTime(d: Date | string | number) {
  const date = new Date(d);
  return date.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" });
}

export function fmtDateTime(d: Date | string | number) {
  const date = new Date(d);
  return `${date.toISOString().slice(0, 10)} ${fmtTime(date)}`;
}

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Deterministic PRNG so illustrative data is stable between renders. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
