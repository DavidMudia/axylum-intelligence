import { TerminalSection } from "@/components/terminal/TerminalSection";
import { Mt5TradingPanel } from "@/components/terminal/Mt5TradingPanel";

export default function Trading() {
  return (
    <div className="space-y-8">
      <Mt5TradingPanel />
      <TerminalSection section="trading" />
    </div>
  );
}
