const previewQuote = {
  sourceChain: "Ethereum (sample)",
  asset: "USDC (sample)",
  amount: "25.00 USDC",
  estimatedReceive: "24.87 USDC",
};

export function CrossNetworkPreview() {
  return (
    <section
      aria-labelledby="cross-network-preview-title"
      className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
            Preview only — not live
          </p>
          <h2 id="cross-network-preview-title" className="mt-2 text-lg font-semibold text-white">
            Pay from another network
          </h2>
        </div>
        <span className="rounded-full border border-amber-400/30 px-3 py-1 text-xs text-amber-200">
          Static sample
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-300">
        NEAR Intents currently has no testnet. This illustrative quote is not fetched
        from a service and cannot create a deposit address, bridge funds, or send a
        transaction.
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
          <dt className="text-xs text-slate-400">Source chain</dt>
          <dd className="mt-1 font-medium text-white">{previewQuote.sourceChain}</dd>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
          <dt className="text-xs text-slate-400">Asset</dt>
          <dd className="mt-1 font-medium text-white">{previewQuote.asset}</dd>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
          <dt className="text-xs text-slate-400">Amount</dt>
          <dd className="mt-1 font-medium text-white">{previewQuote.amount}</dd>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
          <dt className="text-xs text-slate-400">Estimated receive (sample)</dt>
          <dd className="mt-1 font-medium text-white">{previewQuote.estimatedReceive}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-amber-100/80">
        Amounts are fictional UI examples, not a price estimate. SafePay agreement
        creation and funding still use the configured settlement token on Monad.
      </p>
    </section>
  );
}
