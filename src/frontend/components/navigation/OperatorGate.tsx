"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

type SessionState = "checking" | "authenticated" | "signed-out";

export function OperatorGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/auth/session", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("signed out");
          const result = await response.json() as { authenticated: boolean };
          setSession(result.authenticated ? "authenticated" : "signed-out");
        })
        .catch(() => setSession("signed-out"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json() as { error?: string; authenticated?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Sign-in failed");
      setPassword("");
      setSession(result.authenticated ? "authenticated" : "signed-out");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession("signed-out");
  };

  if (session === "checking") {
    return <div className="grid min-h-[50vh] place-items-center text-[13px] text-fg-3">Checking operator session…</div>;
  }

  if (session === "signed-out") {
    return (
      <main className="grid min-h-[70vh] place-items-center px-4">
        <form onSubmit={signIn} className="glass w-full max-w-[400px] p-6">
          <div className="eyebrow">Axylum Intelligence Terminal</div>
          <h1 className="mt-2 text-[22px] font-semibold text-fg">Operator sign-in</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">Use the administrator credentials configured on this server. They are never sent to the browser except during this HTTPS sign-in request.</p>
          <label className="mt-5 block text-[12px] text-fg-2">Username
            <input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1.5 w-full rounded-lg border hairline bg-black/30 px-3 py-2.5 text-[13px] text-fg outline-none focus:border-accent/40" />
          </label>
          <label className="mt-3 block text-[12px] text-fg-2">Password
            <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border hairline bg-black/30 px-3 py-2.5 text-[13px] text-fg outline-none focus:border-accent/40" />
          </label>
          {error && <p role="alert" className="mt-3 text-[12px] text-down">{error}</p>}
          <button type="submit" disabled={busy} className="mt-5 w-full rounded-lg border border-accent/40 bg-accent/90 px-4 py-2.5 text-[13px] font-medium text-white hover:bg-accent disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </main>
    );
  }

  return (
    <>
      {process.env.NODE_ENV === "production" && (
        <div className="flex justify-end border-b hairline px-4 py-1.5 lg:px-8">
          <button onClick={() => void signOut()} className="text-[11px] text-fg-3 hover:text-fg-2">Sign out</button>
        </div>
      )}
      {children}
    </>
  );
}
