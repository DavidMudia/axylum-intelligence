import { mulberry32 } from "@shared/format";

export type NodeType =
  | "Cryptocurrency"
  | "Exchange"
  | "Wallet"
  | "Organization"
  | "Regulator"
  | "Event"
  | "EconomicIndicator"
  | "Network";

export type GNode = {
  id: string;
  label: string;
  type: NodeType;
  description: string;
  props: Record<string, string>;
  x: number;
  y: number;
};

export type GEdge = {
  id: string;
  source: string;
  target: string;
  rel: string;
  status: "verified" | "inferred";
  confidence: number;
  evidence: string;
  hoursAgo: number;
};

export const NODE_COLORS: Record<NodeType, string> = {
  Cryptocurrency: "#5b8def",
  Exchange: "#8fb4ff",
  Wallet: "#7b8499",
  Organization: "#b3a8ff",
  Regulator: "#d6a24a",
  Event: "#9585f2",
  EconomicIndicator: "#3fbf8f",
  Network: "#5d6b88",
};

type Seed = Omit<GNode, "x" | "y">;

const SEED_NODES: Seed[] = [
  { id: "btc", label: "Bitcoin", type: "Cryptocurrency", description: "Proof-of-work digital asset. Primary monitored instrument.", props: { symbol: "BTC", pair: "BTC/USDT", monitored: "true" } },
  { id: "eth", label: "Ethereum", type: "Cryptocurrency", description: "Smart-contract platform asset.", props: { symbol: "ETH", pair: "ETH/USDT", monitored: "true" } },
  { id: "sol", label: "Solana", type: "Cryptocurrency", description: "High-throughput layer-1 asset.", props: { symbol: "SOL", pair: "SOL/USDT", monitored: "true" } },
  { id: "bnb", label: "BNB", type: "Cryptocurrency", description: "Exchange-linked network asset.", props: { symbol: "BNB", pair: "BNB/USDT", monitored: "true" } },
  { id: "binance", label: "Binance", type: "Exchange", description: "Primary market data venue.", props: { role: "market data", api: "connected" } },
  { id: "coinbase", label: "Coinbase", type: "Exchange", description: "Reference venue for cross-checks.", props: { role: "reference", api: "not configured" } },
  { id: "w1", label: "Wallet cluster A", type: "Wallet", description: "Cluster of addresses sharing common-input ownership heuristics.", props: { label: "inferred", balance: "≈ 48k BTC" } },
  { id: "w2", label: "Wallet cluster B", type: "Wallet", description: "Long-dormant holder cluster.", props: { label: "inferred", dormancy: "6.2 yrs" } },
  { id: "sec", label: "Securities regulator", type: "Regulator", description: "National authority overseeing exchange conduct.", props: { jurisdiction: "US", type: "authority" } },
  { id: "fed", label: "Central bank", type: "Regulator", description: "Sets policy rate; publishes rate decisions.", props: { jurisdiction: "US", type: "central bank" } },
  { id: "ethf", label: "Ethereum Foundation", type: "Organization", description: "Non-profit supporting protocol development.", props: { type: "foundation" } },
  { id: "ev_custody", label: "Custody rule proposal", type: "Event", description: "Official proposal on custody requirements for exchanges.", props: { class: "regulatory", sentiment: "negative", confirmed: "true" } },
  { id: "ev_inflow", label: "Exchange inflow spike", type: "Event", description: "Unusually large deposits to exchange-labelled addresses.", props: { class: "on-chain", severity: "high", confirmed: "partial" } },
  { id: "ev_cpi", label: "CPI release", type: "Event", description: "Inflation release below consensus.", props: { class: "economic", sentiment: "positive", confirmed: "true" } },
  { id: "ev_pause", label: "Withdrawal pause", type: "Event", description: "Temporary pause on network withdrawals at a venue.", props: { class: "exchange incident", confirmed: "true" } },
  { id: "ev_upgrade", label: "Network upgrade", type: "Event", description: "Scheduled protocol upgrade.", props: { class: "project", sentiment: "positive", confirmed: "true" } },
  { id: "cpi", label: "CPI", type: "EconomicIndicator", description: "Consumer price index.", props: { frequency: "monthly" } },
  { id: "rates", label: "Policy rate", type: "EconomicIndicator", description: "Benchmark interest rate.", props: { frequency: "scheduled" } },
  { id: "dxy", label: "US Dollar Index", type: "EconomicIndicator", description: "Dollar strength versus a basket.", props: { frequency: "continuous" } },
  { id: "net_btc", label: "Bitcoin network", type: "Network", description: "Blockchain network.", props: { consensus: "PoW" } },
  { id: "net_eth", label: "Ethereum network", type: "Network", description: "Blockchain network.", props: { consensus: "PoS" } },
  { id: "net_sol", label: "Solana network", type: "Network", description: "Blockchain network.", props: { consensus: "PoS + PoH" } },
  { id: "net_bnb", label: "BNB Chain", type: "Network", description: "Blockchain network.", props: { consensus: "PoSA" } },
];

type E = [string, string, string, "verified" | "inferred", number, string, number];
const SEED_EDGES: E[] = [
  ["btc", "runsOn", "net_btc", "verified", 0.99, "Chain registry", 720],
  ["eth", "runsOn", "net_eth", "verified", 0.99, "Chain registry", 720],
  ["sol", "runsOn", "net_sol", "verified", 0.99, "Chain registry", 720],
  ["bnb", "runsOn", "net_bnb", "verified", 0.99, "Chain registry", 720],
  ["btc", "tradedOn", "binance", "verified", 0.99, "Binance API", 1],
  ["btc", "tradedOn", "coinbase", "verified", 0.97, "Venue listing", 240],
  ["eth", "tradedOn", "binance", "verified", 0.99, "Binance API", 1],
  ["eth", "tradedOn", "coinbase", "verified", 0.97, "Venue listing", 240],
  ["sol", "tradedOn", "binance", "verified", 0.99, "Binance API", 1],
  ["bnb", "tradedOn", "binance", "verified", 0.99, "Binance API", 1],
  ["ethf", "stewards", "net_eth", "verified", 0.9, "Foundation site", 500],
  ["sec", "regulates", "binance", "verified", 0.88, "Public filings", 300],
  ["sec", "regulates", "coinbase", "verified", 0.93, "Public filings", 300],
  ["w1", "holds", "btc", "verified", 0.84, "On-chain provider", 3],
  ["w2", "holds", "btc", "inferred", 0.61, "Dormancy heuristic", 12],
  ["w1", "transferredTo", "binance", "inferred", 0.74, "Address label model", 1.5],
  ["ev_inflow", "involves", "w1", "inferred", 0.74, "On-chain provider", 1.5],
  ["ev_inflow", "reportedAt", "binance", "verified", 0.81, "Chain Ledger", 1.2],
  ["ev_inflow", "pressures", "btc", "inferred", 0.55, "Hypothesis · requires corroboration", 1.1],
  ["ev_custody", "announcedBy", "sec", "verified", 0.96, "Regulatory Gazette", 0.4],
  ["ev_custody", "affects", "binance", "verified", 0.82, "Regulatory Gazette", 0.4],
  ["ev_custody", "affects", "coinbase", "inferred", 0.66, "Entity linking model", 0.4],
  ["ev_custody", "pressures", "btc", "inferred", 0.62, "Event-impact model", 0.35],
  ["ev_cpi", "measures", "cpi", "verified", 0.97, "Macro Wire", 2],
  ["ev_cpi", "influences", "rates", "inferred", 0.58, "Historical co-movement", 2],
  ["fed", "sets", "rates", "verified", 0.99, "Policy calendar", 400],
  ["rates", "influences", "dxy", "inferred", 0.63, "Historical co-movement", 24],
  ["dxy", "influences", "btc", "inferred", 0.41, "Rolling correlation (negative)", 24],
  ["ev_pause", "announcedBy", "binance", "verified", 0.94, "Exchange Notice", 3.4],
  ["ev_pause", "affects", "bnb", "verified", 0.9, "Exchange Notice", 3.4],
  ["ev_upgrade", "targets", "eth", "verified", 0.91, "Ethereum Dev Notes", 0.9],
  ["ev_upgrade", "announcedBy", "ethf", "verified", 0.91, "Ethereum Dev Notes", 0.9],
  ["btc", "correlatedWith", "eth", "inferred", 0.74, "30d rolling correlation", 1],
  ["eth", "correlatedWith", "sol", "inferred", 0.66, "30d rolling correlation", 1],
  ["bnb", "correlatedWith", "btc", "inferred", 0.58, "30d rolling correlation", 1],
];

export const EDGES: GEdge[] = SEED_EDGES.map(([source, rel, target, status, confidence, evidence, hoursAgo], i) => ({
  id: `e${i}`,
  source,
  target,
  rel,
  status,
  confidence,
  evidence,
  hoursAgo,
}));

export const RELATION_TYPES = Array.from(new Set(EDGES.map((e) => e.rel))).sort();

function layout(): GNode[] {
  const rnd = mulberry32(42);
  const W = 1000;
  const H = 640;
  const nodes = SEED_NODES.map((n, i) => {
    const a = (i / SEED_NODES.length) * Math.PI * 2;
    return { ...n, x: W / 2 + Math.cos(a) * 280 + (rnd() - 0.5) * 40, y: H / 2 + Math.sin(a) * 200 + (rnd() - 0.5) * 40 };
  });
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const vx = new Array(nodes.length).fill(0);
  const vy = new Array(nodes.length).fill(0);
  for (let it = 0; it < 380; it++) {
    const cool = 1 - it / 380;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const d2 = Math.max(dx * dx + dy * dy, 60);
        const f = 9000 / d2;
        const d = Math.sqrt(d2);
        vx[i] += (dx / d) * f;
        vy[i] += (dy / d) * f;
        vx[j] -= (dx / d) * f;
        vy[j] -= (dy / d) * f;
      }
    }
    for (const e of EDGES) {
      const a = idx.get(e.source)!;
      const b = idx.get(e.target)!;
      const dx = nodes[b].x - nodes[a].x;
      const dy = nodes[b].y - nodes[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 120) * 0.02;
      vx[a] += (dx / d) * f;
      vy[a] += (dy / d) * f;
      vx[b] -= (dx / d) * f;
      vy[b] -= (dy / d) * f;
    }
    for (let i = 0; i < nodes.length; i++) {
      vx[i] += (W / 2 - nodes[i].x) * 0.004;
      vy[i] += (H / 2 - nodes[i].y) * 0.006;
      nodes[i].x += Math.max(-14, Math.min(14, vx[i])) * cool;
      nodes[i].y += Math.max(-14, Math.min(14, vy[i])) * cool;
      vx[i] *= 0.55;
      vy[i] *= 0.55;
    }
  }
  const minX = Math.min(...nodes.map((n) => n.x));
  const maxX = Math.max(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxY = Math.max(...nodes.map((n) => n.y));
  return nodes.map((n) => ({
    ...n,
    x: 60 + ((n.x - minX) / (maxX - minX)) * (W - 120),
    y: 50 + ((n.y - minY) / (maxY - minY)) * (H - 100),
  }));
}

export const NODES: GNode[] = layout();
export const GRAPH_SIZE = { w: 1000, h: 640 };

export const nodeById = (id: string) => NODES.find((n) => n.id === id)!;

/* ---------- RDF / SPARQL ---------- */

const PREFIX = "https://axylum.local/ontology#";

export function toTurtle(id: string) {
  const n = nodeById(id);
  const out = EDGES.filter((e) => e.source === id);
  const lines = [
    `@prefix ax:   <${PREFIX}> .`,
    `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
    ``,
    `ax:${n.id} a ax:${n.type} ;`,
    `    rdfs:label "${n.label}" ;`,
  ];
  Object.entries(n.props).forEach(([k, v]) => lines.push(`    ax:${k} "${v}" ;`));
  out.forEach((e) =>
    lines.push(`    ax:${e.rel} ax:${e.target} ;  # ${e.status} · conf ${e.confidence.toFixed(2)} · ${e.evidence}`),
  );
  if (lines[lines.length - 1].endsWith(";") || lines[lines.length - 1].includes(" ;  #")) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(" ;", " .");
  }
  const inbound = EDGES.filter((e) => e.target === id);
  if (inbound.length) {
    lines.push("", "# inbound");
    inbound.forEach((e) => lines.push(`ax:${e.source} ax:${e.rel} ax:${id} .  # ${e.status} · conf ${e.confidence.toFixed(2)}`));
  }
  return lines.join("\n");
}

type Triple = [string, string, string];
function triples(): Triple[] {
  const t: Triple[] = [];
  NODES.forEach((n) => {
    t.push([`:${n.id}`, ":type", `:${n.type}`]);
    t.push([`:${n.id}`, ":label", `"${n.label}"`]);
  });
  EDGES.forEach((e) => t.push([`:${e.source}`, `:${e.rel}`, `:${e.target}`]));
  return t;
}

export const SPARQL_PRESETS = [
  {
    name: "Events pressuring assets",
    query: `PREFIX : <${PREFIX}>

SELECT ?event ?asset
WHERE {
  ?event :pressures ?asset .
  ?asset :type :Cryptocurrency .
}`,
  },
  {
    name: "Regulated exchanges",
    query: `PREFIX : <${PREFIX}>

SELECT ?authority ?exchange
WHERE {
  ?authority :regulates ?exchange .
  ?exchange :type :Exchange .
}`,
  },
  {
    name: "Assets traded on Binance",
    query: `PREFIX : <${PREFIX}>

SELECT ?asset
WHERE {
  ?asset :tradedOn :binance .
}`,
  },
  {
    name: "Macro → asset chains",
    query: `PREFIX : <${PREFIX}>

SELECT ?indicator ?asset
WHERE {
  ?indicator :influences ?asset .
  ?asset :type :Cryptocurrency .
}`,
  },
];

export function runSparql(query: string): { vars: string[]; rows: Record<string, string>[]; error?: string } {
  try {
    const clean = query.replace(/^\s*(PREFIX|prefix)[^\n]*\n/gm, "");
    const select = clean.match(/SELECT\s+([\s\S]*?)\s+WHERE/i);
    const body = clean.match(/WHERE\s*\{([\s\S]*)\}/i);
    if (!select || !body) return { vars: [], rows: [], error: "Expected: SELECT ?var … WHERE { … }" };
    const vars = select[1].trim().split(/\s+/).filter((v) => v.startsWith("?"));
    const limit = clean.match(/LIMIT\s+(\d+)/i);
    const patterns = body[1]
      .split(/\s\.\s*\n|\s\.\s|\.\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.match(/"[^"]*"|\S+/g) ?? [])
      .filter((p) => p.length === 3);
    if (!patterns.length) return { vars, rows: [], error: "No valid triple patterns found." };
    const data = triples();
    let bindings: Record<string, string>[] = [{}];
    for (const p of patterns) {
      const next: Record<string, string>[] = [];
      for (const b of bindings) {
        for (const tr of data) {
          const nb = { ...b };
          let ok = true;
          for (let i = 0; i < 3; i++) {
            const term = p[i];
            if (term.startsWith("?")) {
              if (nb[term] && nb[term] !== tr[i]) ok = false;
              else nb[term] = tr[i];
            } else if (term !== tr[i]) ok = false;
            if (!ok) break;
          }
          if (ok) next.push(nb);
        }
      }
      bindings = next;
    }
    const rows = bindings.slice(0, limit ? Number(limit[1]) : 50).map((b) => {
      const r: Record<string, string> = {};
      vars.forEach((v) => (r[v] = b[v] ?? ""));
      return r;
    });
    return { vars, rows };
  } catch {
    return { vars: [], rows: [], error: "Query could not be parsed." };
  }
}
