import Link from "next/link";
import { ArrowRight, Network } from "lucide-react";
import { PageHeader, Panel } from "@/components/glass";

export default function KnowledgeGraph() {
  return (
    <>
      <PageHeader
        eyebrow="Semantic knowledge graph"
        title="Connected market evidence"
        description="A knowledge graph requires persisted entities, relationships, and evidence provenance."
      />
      <Panel hover={false} className="p-6 sm:p-8">
        <div className="mx-auto max-w-2xl text-center">
          <Network className="mx-auto text-fg-3" size={28} strokeWidth={1.5} />
          <h2 className="mt-4 text-[17px] font-medium text-fg">No knowledge-graph data source is configured</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-3">
            There are no persisted graph entities or relationships. The previous example graph and local SPARQL console were illustrative only,
            so they have been removed rather than presented as verified market evidence.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/intelligence" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-[12.5px] text-fg-2 transition-colors hover:bg-white/[0.05] hover:text-fg">
              View current analysis <ArrowRight size={13} />
            </Link>
            <Link href="/data-sources" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-[12.5px] text-fg-2 transition-colors hover:bg-white/[0.05] hover:text-fg">
              Check configured data sources <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </Panel>
    </>
  );
}
