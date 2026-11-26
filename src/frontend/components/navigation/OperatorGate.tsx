"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useUI } from "@/stores/ui";
import { readAuthResponse, type AuthApiResponse } from "@/lib/auth-response";

type SessionState = "checking" | "authenticated" | "signed-out";
type AuthMode = "login" | "signup" | "operator";
type AuthUser = { email: string; role: string };

export function OperatorGate({ children }: { children: ReactNode }) {
  const refreshSystem = useUI((state) => state.refreshSystem);
  const [session, setSession] = useState<SessionState>("checking");
  const [mode, setMode] = useState<AuthMode>("login");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [bootstrapConfigured, setBootstrapConfigured] = useState(true);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [operatorLoginAvailable, setOperatorLoginAvailable] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/auth/session", { cache: "no-store" })
        .then(async (response) => {
          const result = await readAuthResponse(response);
          if (!response.ok) throw new Error(result.error ?? "Unable to check your sign-in status");
          setBootstrapRequired(result.bootstrapRequired ?? false);
          setBootstrapConfigured(result.bootstrapConfigured ?? true);
          setBootstrapAvailable(result.bootstrapAvailable ?? false);
          setOperatorLoginAvailable(result.operatorLoginAvailable ?? false);
          if (result.authenticated && result.user) {
            setUser(result.user);
            setSession("authenticated");
          } else {
            setSession("signed-out");
          }
        })
        .catch((reason) => {
          setError(reason instanceof Error ? reason.message : String(reason));
          setSession("signed-out");
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (session !== "authenticated") return;
    void refreshSystem();
    const timer = window.setInterval(() => void refreshSystem(), 15000);
    return () => window.clearInterval(timer);
  }, [refreshSystem, session]);

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const endpoint = mode === "signup" ? "/api/auth/register" : mode === "operator" ? "/api/auth/operator-login" : "/api/auth/login";
      const body = mode === "operator"
        ? { username, password }
        : mode === "signup"
          ? { email, password, ...(bootstrapSecret ? { bootstrapSecret } : {}) }
          : { email, password };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: AuthApiResponse = await readAuthResponse(response);
      if (!response.ok) throw new Error(result.error ?? "Sign-in failed");
      setUser(result.user ?? (mode === "operator" ? { email: username, role: "admin" } : null));
      setPassword("");
      setBootstrapSecret("");
      setSession("authenticated");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out failed");
      setUser(null);
      setSession("signed-out");
      setMode("login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (session === "checking") {
    return <div className="grid min-h-[50vh] place-items-center text-[13px] text-fg-3">Checking your session…</div>;
  }

  if (session === "signed-out") {
    return (
      <main className="grid min-h-[70vh] place-items-center px-4">
        <form onSubmit={authenticate} className="glass w-full max-w-[420px] p-6">
          <div className="eyebrow">Axylum Intelligence Terminal</div>
          <h1 className="mt-2 text-[22px] font-semibold text-fg">
            {mode === "signup" ? "Create your account" : mode === "operator" ? "Operator sign-in" : "Sign in"}
          </h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
            {mode === "operator"
              ? "Use the server administrator credentials."
              : mode === "signup"
                ? "Create a separate Axylum account. Use a unique password."
                : "Sign in to your Axylum account."}
          </p>
          <div className="mt-5 flex gap-2" role="group" aria-label="Account action">
            <button type="button" aria-pressed={mode === "login"} onClick={() => { setMode("login"); setError(""); }} className={`flex-1 rounded-lg border px-3 py-2 text-[12px] ${mode === "login" ? "border-accent/40 bg-accent/10 text-fg" : "hairline text-fg-3"}`}>Sign in</button>
            <button type="button" aria-pressed={mode === "signup"} onClick={() => { setMode("signup"); setError(""); }} className={`flex-1 rounded-lg border px-3 py-2 text-[12px] ${mode === "signup" ? "border-accent/40 bg-accent/10 text-fg" : "hairline text-fg-3"}`}>Sign up</button>
            {operatorLoginAvailable && (
              <button type="button" aria-pressed={mode === "operator"} onClick={() => { setMode("operator"); setError(""); }} className={`flex-1 rounded-lg border px-3 py-2 text-[12px] ${mode === "operator" ? "border-accent/40 bg-accent/10 text-fg" : "hairline text-fg-3"}`}>Operator</button>
            )}
          </div>
          {mode !== "operator" ? (
            <label className="mt-4 block text-[12px] text-fg-2">Email
              <input autoComplete="email" type="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-lg border hairline bg-black/30 px-3 py-2.5 text-[13px] text-fg outline-none focus:border-accent/40" />
            </label>
          ) : (
            <label className="mt-4 block text-[12px] text-fg-2">Username
              <input autoComplete="username" maxLength={256} required value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1.5 w-full rounded-lg border hairline bg-black/30 px-3 py-2.5 text-[13px] text-fg outline-none focus:border-accent/40" />
            </label>
          )}
          <label className="mt-3 block text-[12px] text-fg-2">Password
            <input autoComplete={mode === "signup" ? "new-password" : "current-password"} type="password" minLength={mode === "signup" ? 12 : undefined} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border hairline bg-black/30 px-3 py-2.5 text-[13px] text-fg outline-none focus:border-accent/40" />
          </label>
          {mode === "signup" && bootstrapAvailable && (
            <label className="mt-3 block text-[12px] text-fg-2">
              One-time administrator setup code{bootstrapRequired ? "" : " (optional)"}
              <input autoComplete="off" type="password" required={bootstrapRequired} value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} className="mt-1.5 w-full rounded-lg border hairline bg-black/30 px-3 py-2.5 text-[13px] text-fg outline-none focus:border-accent/40" />
              {!bootstrapRequired && <span className="mt-1 block text-[11px] text-fg-4">Use only if you intend to create an administrator account. The code can be used once.</span>}
            </label>
          )}
          {mode === "signup" && bootstrapRequired && !bootstrapConfigured && (
            <p className="mt-3 text-[12px] text-down">The server must configure `AUTH_BOOTSTRAP_ADMIN_SECRET` before the first production account can be created.</p>
          )}
          {error && <p role="alert" className="mt-3 text-[12px] text-down">{error}</p>}
          <button type="submit" disabled={busy || (mode === "signup" && bootstrapRequired && !bootstrapConfigured)} className="mt-5 w-full rounded-lg border border-accent/40 bg-accent/90 px-4 py-2.5 text-[13px] font-medium text-white hover:bg-accent disabled:opacity-50">
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          {mode === "signup" && <p className="mt-3 text-[11px] leading-relaxed text-fg-4">Passwords must be at least 12 characters. Email verification and password recovery are not available yet.</p>}
        </form>
      </main>
    );
  }

  return (
    <>
      <div className="flex justify-end gap-3 border-b hairline px-4 py-1.5 lg:px-8">
        <span className="text-[11px] text-fg-4">{user?.email} · {user?.role}</span>
        <button onClick={() => void signOut()} className="text-[11px] text-fg-3 hover:text-fg-2">Sign out</button>
      </div>
      {user?.role !== "admin" && (
        <div className="border-b hairline bg-white/[0.02] px-4 py-2 text-center text-[11px] text-fg-3">
          Read-only account. The current paper portfolio and strategies are shared system simulations, not personal portfolios.
        </div>
      )}
      {children}
    </>
  );
}
