"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Badge, Button, PageHeader, Panel, PanelHeader } from "@/components/glass";

type BinanceConnection = {
  id: string;
  exchange: string;
  label: string;
  permissions: string;
  status: string;
  createdAt?: string;
};

type Mt5Account = {
  id: string;
  broker?: string;
  server: string;
  accountType: string;
  connected: boolean;
};

type Mt5Bridge = {
  id: string;
  name: string;
  status: string;
  terminalVersion: string | null;
  lastHeartbeatAt: string | null;
};

type Mt5BridgeCredentials = {
  bridgeId: string;
  token: string;
  name: string;
};

export default function AccountsPage() {
  const [connections, setConnections] = useState<BinanceConnection[]>([]);
  const [mt5Accounts, setMt5Accounts] = useState<Mt5Account[]>([]);
  const [mt5Bridges, setMt5Bridges] = useState<Mt5Bridge[]>([]);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [bridgeName, setBridgeName] = useState("");
  const [bridgeCredentials, setBridgeCredentials] = useState<Mt5BridgeCredentials | null>(null);
  const [mt5Error, setMt5Error] = useState("");
  const [mt5Notice, setMt5Notice] = useState("");
  const [mt5Unavailable, setMt5Unavailable] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [binanceResponse, mt5Response, bridgeResponse] = await Promise.all([
        fetch("/api/accounts/binance", { cache: "no-store" }),
        fetch("/api/mt5/accounts", { cache: "no-store" }),
        fetch("/api/mt5/bridges", { cache: "no-store" }),
      ]);
      const binance = await binanceResponse.json() as { connections?: BinanceConnection[]; error?: string };
      if (!binanceResponse.ok) throw new Error(binance.error ?? "Unable to load Binance connections");
      setConnections(binance.connections ?? []);
      const mt5 = await mt5Response.json() as { accounts?: Mt5Account[]; error?: string };
      if (mt5Response.ok) {
        setMt5Accounts(mt5.accounts ?? []);
        setMt5Error("");
        setMt5Unavailable(false);
      } else if (mt5Response.status === 402) {
        setMt5Accounts([]);
        setMt5Error("MT5 demo integration requires Professional.");
        setMt5Unavailable(true);
      } else if (mt5Response.status === 401) {
        setMt5Unavailable(false);
        setMt5Error("Your session is no longer authorized to view MT5 accounts. Sign in again and retry.");
      } else {
        setMt5Unavailable(false);
        setMt5Error(mt5.error ?? "Unable to load MT5 accounts");
      }
      const bridges = await bridgeResponse.json() as { bridges?: Mt5Bridge[]; error?: string };
      if (bridgeResponse.ok) {
        setMt5Bridges(bridges.bridges ?? []);
      } else if (bridgeResponse.status !== 402 && mt5Response.ok) {
        setMt5Error(bridges.error ?? "Unable to load MT5 bridge status");
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  const refreshAfterMutation = async (completedAction: string) => {
    try {
      await refresh();
    } catch (reason) {
      setError(`${completedAction}, but account status could not be refreshed: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const connectBinance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/accounts/binance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, apiKey, apiSecret }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to connect Binance");
      setApiKey("");
      setApiSecret("");
      setLabel("");
      await refreshAfterMutation("Binance connection was saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const disconnectBinance = async (id: string) => {
    if (!window.confirm("Disconnect this Binance account and delete its encrypted credentials?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/accounts/binance/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to disconnect Binance");
      await refreshAfterMutation("Binance was disconnected");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const recheckBinance = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/accounts/binance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recheck", connectionId: id }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Binance credential validation failed");
      await refreshAfterMutation("Binance credentials were validated");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const registerMt5Bridge = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mt5/bridges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bridgeName }),
      });
      const body = await response.json() as { bridge?: { id: string; name: string }; token?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to register MT5 bridge");
      if (!body.bridge?.id || !body.bridge.name || !body.token) throw new Error("Bridge was created but its one-time credentials were not returned.");
      setBridgeCredentials({ bridgeId: body.bridge.id, name: body.bridge.name, token: body.token });
      setBridgeName("");
      await refreshAfterMutation("MT5 bridge was registered");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const updateMt5Bridge = async (bridgeId: string, action: "rotate" | "disconnect") => {
    const confirmation = action === "disconnect"
      ? "Disconnect this bridge now? Its token will stop working and linked account history will be retained."
      : "Rotate this bridge token? The current token will stop working immediately.";
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    setError("");
    setBridgeCredentials(null);
    try {
      const response = await fetch(`/api/mt5/bridges/${encodeURIComponent(bridgeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json() as {
        bridge?: { id: string; name: string };
        token?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Unable to update MT5 bridge");
      if (action === "rotate") {
        if (!body.bridge?.id || !body.bridge.name || !body.token) throw new Error("Bridge token was rotated but its one-time credentials were not returned.");
        setBridgeCredentials({ bridgeId: body.bridge.id, name: body.bridge.name, token: body.token });
      }
      await refreshAfterMutation(action === "disconnect" ? "MT5 bridge was disconnected" : "MT5 bridge token was rotated");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyBridgeConfiguration = async () => {
    if (!bridgeCredentials) return;
    setMt5Notice("");
    const configuration = [
      `AXYLUM_API_BASE_URL=${window.location.origin}`,
      `AXYLUM_BRIDGE_ID=${bridgeCredentials.bridgeId}`,
      `AXYLUM_BRIDGE_TOKEN=${bridgeCredentials.token}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(configuration);
      setMt5Notice("Bridge configuration copied. Store it only in the trusted Windows service environment.");
      setError("");
    } catch {
      setError("Clipboard access is unavailable. Copy the bridge configuration shown below manually.");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Accounts & integrations"
        description="Manage your own exchange credentials and view your linked demo trading accounts."
        actions={<Button onClick={() => void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))} disabled={busy || refreshing}><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh accounts</Button>}
      />
      {error && <div role="alert" className="mb-4 rounded-lg border border-down/30 bg-down/10 px-4 py-3 text-[12px] text-[#ec8696]">{error}</div>}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel hover={false}>
          <PanelHeader eyebrow="Binance · read only" title="Exchange connections" />
          <div className="space-y-2 px-5 pb-5">
            {connections.length === 0 && <p className="text-[12px] text-fg-3">No Binance API keys are connected.</p>}
            {connections.map((connection) => (
              <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border hairline bg-white/[0.02] px-3 py-3">
                <div>
                  <div className="text-[12px] text-fg">{connection.label}</div>
                  <div className="mt-1 text-[10px] text-fg-4">Trading and withdrawal permissions are disabled</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={connection.status === "connected" ? "emerald" : "amber"} dot>{connection.status}</Badge>
                  <Button disabled={busy} onClick={() => void recheckBinance(connection.id)}>Recheck</Button>
                  <Button variant="danger" disabled={busy} onClick={() => void disconnectBinance(connection.id)}>Disconnect</Button>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={connectBinance} className="grid gap-3 border-t hairline px-5 py-4">
            <label className="text-[11px] text-fg-3">Connection label
              <input required maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-lg border hairline bg-black/30 px-3 text-[12px] text-fg outline-none focus:border-accent/40" />
            </label>
            <label className="text-[11px] text-fg-3">Binance API key
              <input required autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-lg border hairline bg-black/30 px-3 text-[12px] text-fg outline-none focus:border-accent/40" />
            </label>
            <label className="text-[11px] text-fg-3">Binance API secret
              <input required type="password" autoComplete="new-password" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-lg border hairline bg-black/30 px-3 text-[12px] text-fg outline-none focus:border-accent/40" />
            </label>
            <p className="text-[10.5px] leading-relaxed text-fg-4">Use a dedicated read-only key with reading enabled and trading, withdrawal, and transfer permissions disabled. Credentials are encrypted server-side and never returned to the browser.</p>
            <Button type="submit" variant="primary" disabled={busy || !label.trim() || !apiKey || !apiSecret}>
              {busy ? "Validating…" : "Validate and connect"}
            </Button>
          </form>
        </Panel>

        <Panel hover={false} tone="violet">
          <PanelHeader eyebrow="MetaTrader 5 · demo" title="Trading connections" action={<Link href="/trading" className="text-[11px] text-[#b9aef7] hover:underline">Open trading</Link>} />
          <div className="space-y-3 px-5 pb-5">
            {mt5Error && <p className="rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] text-[#e3bd78]">{mt5Error} {mt5Unavailable && <Link href="/billing" className="underline">View plans</Link>}</p>}
            {mt5Notice && <p role="status" className="rounded-lg border border-up/20 bg-up/5 px-3 py-2 text-[11px] text-[#6fd6ad]">{mt5Notice}</p>}
            {bridgeCredentials && (
              <div role="status" className="rounded-lg border border-violet-300/25 bg-violet-400/[0.06] p-3">
                <p className="text-[11px] font-medium text-fg">Save this one-time bridge configuration</p>
                <p className="mt-1 text-[10px] leading-relaxed text-fg-4">The token is shown only now. Keep it in the trusted Windows bridge environment; Axylum stores only its hash.</p>
                <textarea
                  readOnly
                  rows={3}
                  value={[
                    `AXYLUM_API_BASE_URL=${typeof window === "undefined" ? "" : window.location.origin}`,
                    `AXYLUM_BRIDGE_ID=${bridgeCredentials.bridgeId}`,
                    `AXYLUM_BRIDGE_TOKEN=${bridgeCredentials.token}`,
                  ].join("\n")}
                  className="mt-2 w-full resize-y rounded-md border hairline bg-black/40 p-2 font-mono text-[10px] text-fg"
                />
                <div className="mt-2 flex gap-2">
                  <Button onClick={() => void copyBridgeConfiguration()}>Copy configuration</Button>
                  <Button onClick={() => setBridgeCredentials(null)}>Hide token</Button>
                </div>
              </div>
            )}
            <form onSubmit={registerMt5Bridge} className="grid gap-2 border-b hairline pb-3">
              <label className="text-[11px] text-fg-3">Register a Windows bridge
                <input
                  required
                  maxLength={100}
                  value={bridgeName}
                  onChange={(event) => setBridgeName(event.target.value)}
                  placeholder="e.g. My demo terminal"
                  className="mt-1.5 min-h-10 w-full rounded-lg border hairline bg-black/30 px-3 text-[12px] text-fg outline-none focus:border-accent/40"
                />
              </label>
              <p className="text-[10.5px] leading-relaxed text-fg-4">Professional access is required. The bridge connects outbound from the Windows host and uses the MT5 terminal already signed in to a demo account.</p>
              <Button type="submit" variant="primary" disabled={busy || mt5Unavailable || !bridgeName.trim()}>
                {busy ? "Registering…" : "Create bridge credentials"}
              </Button>
            </form>
            {mt5Bridges.length === 0 && <p className="text-[12px] text-fg-3">No MT5 bridges are registered for this user.</p>}
            {mt5Bridges.map((bridge) => (
              <div key={bridge.id} className="rounded-lg border hairline bg-white/[0.02] px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] text-fg">{bridge.name}</div>
                    <div className="mt-1 text-[10px] text-fg-4">
                      {bridge.terminalVersion ? `Terminal ${bridge.terminalVersion} · ` : ""}
                      {bridge.lastHeartbeatAt ? `Last heartbeat ${new Date(bridge.lastHeartbeatAt).toLocaleString()}` : "No heartbeat yet"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={bridge.status === "online" ? "emerald" : bridge.status === "degraded" ? "amber" : "crimson"} dot>{bridge.status}</Badge>
                    <Button disabled={busy || mt5Unavailable} onClick={() => void updateMt5Bridge(bridge.id, "rotate")}>Rotate token</Button>
                    <Button variant="danger" disabled={busy} onClick={() => void updateMt5Bridge(bridge.id, "disconnect")}>Disconnect</Button>
                  </div>
                </div>
              </div>
            ))}
            {mt5Accounts.map((account) => (
              <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border hairline bg-white/[0.02] px-3 py-3">
                <div>
                  <div className="text-[12px] text-fg">{account.broker || account.server}</div>
                  <div className="mt-1 text-[10px] text-fg-4">{account.server} · {account.accountType}</div>
                </div>
                <Badge tone={account.connected ? "emerald" : "amber"} dot>{account.connected ? "Connected" : "Offline"}</Badge>
              </div>
            ))}
            <p className="border-t hairline pt-3 text-[10.5px] leading-relaxed text-fg-4">MT5 account records are user-scoped and demo-only. Disconnecting invalidates the bridge token and retains linked account history; reconnecting issues a new one-time token.</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
