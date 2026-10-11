"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useSafePayWallet } from "@/lib/wallet/useSafePayWallet";

export default function Home() {
  const wallet = useSafePayWallet();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const configured = wallet.provider === "privy"
    ? Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)
    : wallet.provider === "dynamic"
      ? Boolean(process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID)
      : true;

  useEffect(() => {
    if (!wallet.authenticated) return;
    const returnTo = window.sessionStorage.getItem("safepay-return-to");
    if (!returnTo) return;
    window.sessionStorage.removeItem("safepay-return-to");
    if (returnTo.startsWith("/") && !returnTo.startsWith("//")) router.replace(returnTo);
  }, [wallet.authenticated, router]);

  const handleLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      if (wallet.provider === "privy") {
        if (!wallet.login) throw new Error("Privy is still initializing.");
        await wallet.login();
      } else {
        if (!wallet.sendLoginCode) throw new Error("Dynamic is still initializing.");
        await wallet.sendLoginCode(email);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!wallet.verifyLoginCode) throw new Error("Dynamic is still initializing.");
      await wallet.verifyLoginCode(code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the email code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900 p-8 text-slate-50 shadow-2xl shadow-violet-950/20">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-400">SafePay</p>
        <h1 className="mt-4 text-3xl font-semibold">Milestone escrow prototype</h1>
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          SafePayEscrow and the configured token are not deployed at their current
          Monad Testnet addresses. Do not use this prototype to send or hold funds.
        </div>

        {!wallet.role ? (
          <section className="mt-6">
            <h2 className="text-lg font-semibold">How will you use SafePay?</h2>
            <p className="mt-2 text-sm text-slate-400">Your choice selects the wallet provider for this browser session.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => wallet.selectRole("client")}
                className="rounded-xl bg-violet-600 px-4 py-4 text-left font-semibold hover:bg-violet-500"
              >
                Hire <span className="mt-1 block text-sm font-normal text-violet-100">Continue with Privy</span>
              </button>
              <button
                type="button"
                onClick={() => wallet.selectRole("freelancer")}
                className="rounded-xl bg-teal-700 px-4 py-4 text-left font-semibold hover:bg-teal-600"
              >
                Offer services <span className="mt-1 block text-sm font-normal text-teal-100">Continue with Dynamic</span>
              </button>
            </div>
          </section>
        ) : wallet.authenticated ? (
          <section className="mt-6 space-y-4">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-300">
                {wallet.role === "client" ? "Client · Privy" : "Freelancer · Dynamic"}
              </p>
              <p className="mt-2 break-all text-base text-white">{wallet.address ?? "Wallet initializing…"}</p>
              <p className="mt-1 text-sm text-slate-300">
                {wallet.chainName} {wallet.chainId ? `(chain ${wallet.chainId})` : "(switching wallet network…)"}
              </p>
            </div>
            {wallet.error ? <p role="alert" className="rounded-xl border border-red-500/40 bg-red-950/50 p-3 text-sm text-red-200">{wallet.error}</p> : null}
            <nav className="grid gap-3 sm:grid-cols-2">
              <Link href="/dashboard" className="rounded-xl bg-violet-600 px-4 py-3 text-center font-semibold hover:bg-violet-500">Open dashboard</Link>
              <Link href="/create" className="rounded-xl border border-violet-500/50 bg-violet-500/10 px-4 py-3 text-center font-semibold text-violet-200 hover:bg-violet-500/20">Create agreement</Link>
              <Link href="/services" className="rounded-xl border border-teal-500/50 bg-teal-500/10 px-4 py-3 text-center font-semibold text-teal-200 hover:bg-teal-500/20">Browse freelance services</Link>
              {wallet.role === "freelancer" ? <Link href="/services/new" className="rounded-xl border border-teal-500/50 px-4 py-3 text-center font-semibold text-teal-200 hover:bg-teal-500/10">Publish a service</Link> : null}
            </nav>
            <button type="button" onClick={() => void wallet.logout()} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold hover:border-slate-500">Log out and change role</button>
          </section>
        ) : !configured ? (
          <section className="mt-6 rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-200">
            {wallet.provider === "privy"
              ? "Set NEXT_PUBLIC_PRIVY_APP_ID to enable client sign-in."
              : "Set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID to enable freelancer sign-in."}
            <button type="button" onClick={wallet.clearRole} className="ml-3 underline">Choose another role</button>
          </section>
        ) : (
          <section className="mt-6 space-y-4">
            <p className="text-slate-300">
              {wallet.role === "client" ? "Client wallet authentication uses Privy." : "Freelancer wallet authentication uses Dynamic."}
            </p>
            {wallet.provider === "dynamic" ? (
              <>
                <label className="block text-sm text-slate-300">
                  Email
                  <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
                </label>
                {wallet.otpSent ? (
                  <label className="block text-sm text-slate-300">
                    Email code
                    <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
                  </label>
                ) : null}
              </>
            ) : null}
            {wallet.error ? <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/50 p-3 text-sm text-red-200">{wallet.error}</p> : null}
            {wallet.provider === "dynamic" && wallet.otpSent ? (
              <button type="button" onClick={() => void handleVerify()} disabled={busy || !wallet.ready} className="w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold hover:bg-teal-600 disabled:opacity-50">{busy ? "Verifying…" : "Verify email code"}</button>
            ) : (
              <button type="button" onClick={() => void handleLogin()} disabled={busy || !wallet.ready || (wallet.provider === "dynamic" && !email)} className="w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold hover:bg-violet-500 disabled:opacity-50">
                {busy ? "Signing in…" : wallet.provider === "dynamic" ? "Send email code" : "Continue with Privy"}
              </button>
            )}
            <button type="button" onClick={wallet.clearRole} className="w-full text-sm text-slate-400 underline">Back and choose a different role</button>
            {error ? <p role="alert" className="rounded-xl border border-red-500/40 bg-red-950/50 p-3 text-sm text-red-200">{error}</p> : null}
          </section>
        )}
      </div>
    </main>
  );
}
