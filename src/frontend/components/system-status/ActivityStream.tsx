"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Ban, CheckCircle2, FileText, Network, Radar, Tag, Target, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, StatusDot } from "@/components/glass";
import { cn, fmtTime } from "@/lib/format";

type Ev = { id: number; kind: string; title: string; detail: string; status: string; asset: string | null; createdAt: string };

const KIND: Record<string, { icon: LucideIcon; color: string }> = {
  anomaly: { icon: Radar, color: "text-warn" },
  article: { icon: FileText, color: "text-[#9db8f5]" },
  graph: { icon: Network, color: "text-[#b9aef7]" },
  prediction: { icon: Target, color: "text-[#b9aef7]" },
  entity: { icon: Tag, color: "text-[#9db8f5]" },
  evaluation: { icon: CheckCircle2, color: "text-up" },
  rejected: { icon: Ban, color: "text-down" },
};

function statusTone(s: string) {
  if (["Rejected"].includes(s)) return "crimson" as const;
  if (["Investigating", "Monitoring", "Unverified"].includes(s)) return "amber" as const;
  if (["Awaiting confirmation"].includes(s)) return "violet" as const;
  if (["Processed", "Indexed", "Verified", "Completed", "Published"].includes(s)) return "emerald" as const;
  return "neutral" as const;
}

export function ActivityStream({ onClose, className }: { onClose?: () => void; className?: string }) {
  const [events, setEvents] = useState<Ev[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/activity", { cache: "no-store" });
        if (r.ok && alive) setEvents((await r.json()).events);
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className={cn("glass flex h-full flex-col overflow-hidden", className)}>
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <div className="eyebrow">Live intelligence</div>
          <div className="mt-1 flex items-center gap-2 text-[13px] text-fg">
            <StatusDot status="ok" pulse />
            Streaming
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-fg-3 hover:bg-white/5 hover:text-fg">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <AnimatePresence initial={false}>
          {events.map((e) => {
            const k = KIND[e.kind] ?? KIND.article;
            const Icon = k.icon;
            return (
              <motion.article
                key={e.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="group rounded-[12px] px-2.5 py-3 transition-colors hover:bg-white/[0.035]"
              >
                <div className="flex gap-3">
                  <div className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/8 bg-white/[0.03]", k.color)}>
                    <Icon size={14} strokeWidth={1.7} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-fg">{e.title}</span>
                      <span className="num text-[10.5px] text-fg-3">{fmtTime(e.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-snug text-fg-2">{e.detail}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Badge tone={statusTone(e.status)} dot>
                        {e.status}
                      </Badge>
                      {e.asset && <span className="num text-[10.5px] text-fg-3">{e.asset}</span>}
                    </div>
                  </div>
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
        {!events.length && <div className="px-3 py-8 text-center text-[12.5px] text-fg-3">Waiting for events…</div>}
      </div>
      <div className="border-t hairline px-5 py-2.5 text-[10.5px] text-fg-3">Illustrative records, not live observations.</div>
    </div>
  );
}
