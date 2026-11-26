import {
  BrainCircuit,
  FlaskConical,
  LayoutGrid,
  LineChart,
  Network,
  Server,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; hint: string };

export const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutGrid, hint: "System dashboard" },
  { href: "/markets", label: "Markets", icon: LineChart, hint: "BTCUSDT spot data" },
  { href: "/intelligence", label: "Intelligence", icon: BrainCircuit, hint: "Analysis and evidence" },
  { href: "/knowledge-graph", label: "Knowledge Graph", icon: Network, hint: "Explore connected entities and relationships" },
  { href: "/strategy-lab", label: "Strategy Lab", icon: FlaskConical, hint: "Rules and backtesting" },
  { href: "/trading", label: "Trading", icon: Wallet, hint: "Autonomous paper portfolio" },
  { href: "/system", label: "System", icon: Server, hint: "Collector, engine and database health" },
];
