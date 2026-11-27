"use client";

import Link from "next/link";
import { ArrowRight, BrainCircuit, FlaskConical } from "lucide-react";
import { PageHeader, Panel } from "@/components/glass";

export default function Models() {
  return (
    <>
      <PageHeader
        eyebrow="Prediction laboratory"
        title="Models"
        description="Model evaluation and registry data will appear here when a trained model and its measured results are configured."
      />
      <Panel hover={false} className="p-6 sm:p-8">
        <div className="mx-auto max-w-2xl text-center">
          <BrainCircuit className="mx-auto text-fg-3" size={28} strokeWidth={1.5} />
          <h2 className="mt-4 text-[17px] font-medium text-fg">No model registry is configured</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-3">
            There are no persisted model versions, training records, evaluation results, or prediction history to display.
            Performance figures and feature-importance values are not available.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/intelligence" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-[12.5px] text-fg-2 transition-colors hover:bg-white/[0.05] hover:text-fg">
              <BrainCircuit size={15} /> View live market analysis <ArrowRight size={13} />
            </Link>
            <Link href="/strategy-lab" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-[12.5px] text-fg-2 transition-colors hover:bg-white/[0.05] hover:text-fg">
              <FlaskConical size={15} /> Run a historical backtest <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </Panel>
    </>
  );
}
