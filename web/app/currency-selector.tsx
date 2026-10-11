"use client";

import { useCallback, useEffect, useState } from "react";

import {
  displayCurrencies,
  type DisplayCurrency,
  type FxRateResponse,
} from "@/lib/currency";

export type FxState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: FxRateResponse; error: null }
  | { status: "error"; data: null; error: string };

async function requestFxRate(
  currency: DisplayCurrency,
  signal?: AbortSignal,
): Promise<FxRateResponse> {
  const response = await fetch(`/api/fx?currency=${currency}`, {
    cache: "no-store",
    signal,
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const body = result as { error?: string };
    throw new Error(body.error ?? "Unable to get a display FX rate.");
  }
  return result as FxRateResponse;
}

export function useFxRate(currency: DisplayCurrency) {
  const [state, setState] = useState<FxState>({
    status: "loading",
    data: null,
    error: null,
  });
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setState({ status: "loading", data: null, error: null });
    try {
      setState({
        status: "ready",
        data: await requestFxRate(currency, signal),
        error: null,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setState({
        status: "error",
        data: null,
        error: error instanceof Error ? error.message : "Unable to get a display FX rate.",
      });
    }
  }, [currency]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await requestFxRate(currency, controller.signal);
        setState({ status: "ready", data, error: null });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : "Unable to get a display FX rate.",
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [currency]);

  const visibleState: FxState =
    state.status === "ready" && state.data.currency !== currency
      ? { status: "loading", data: null, error: null }
      : state;
  return { ...visibleState, refresh: () => refresh() };
}

export function CurrencySelector({
  value,
  onChange,
}: {
  value: DisplayCurrency;
  onChange: (currency: DisplayCurrency) => void;
}) {
  return (
    <label className="text-sm text-slate-300">
      Display currency
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as DisplayCurrency)}
        className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
      >
        {displayCurrencies.map((currency) => (
          <option key={currency} value={currency}>{currency}</option>
        ))}
      </select>
    </label>
  );
}

export function FxRateNotice({
  state,
  currency,
}: {
  state: FxState;
  currency: DisplayCurrency;
}) {
  if (currency === "USD" && state.status === "ready") {
    return (
      <p className="text-xs text-slate-400">
        {state.data.message} Rate timestamp: {new Date(state.data.timestamp).toLocaleString()}.
        Display conversion only; not a live exchange feature.
      </p>
    );
  }
  if (state.status === "loading") {
    return <p role="status" className="text-xs text-slate-400">Loading display FX rate…</p>;
  }
  if (state.status === "error") {
    return <p role="alert" className="text-xs text-red-300">Display conversion unavailable: {state.error}</p>;
  }
  return (
    <div className={`text-xs ${state.data.stale ? "text-amber-200" : "text-slate-400"}`}>
      <p>
        {state.data.stale ? "STALE RATE — " : ""}
        1 USD = {state.data.rate} {currency}; rate timestamp:{" "}
        {new Date(state.data.timestamp).toLocaleString()}
      </p>
      {state.data.message ? <p>{state.data.message}</p> : null}
      <p>Approximate price display only; not a live exchange feature. Settlement remains in the stablecoin.</p>
    </div>
  );
}
