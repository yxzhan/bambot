"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  headsetLink,
  linkWarning,
  Pairing,
  pairingService,
  requestPairingCode,
  sessionToken,
  typedAddress,
} from "@/lib/shareLink";

type PairingState =
  | { status: "loading" }
  | { status: "ready"; pairing: Pairing }
  | { status: "error"; message: string };

function formatRemaining(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * "Open on a headset": a short pairing code from the pairing service, which
 * the headset redeems for this page's link, plus the link itself to copy.
 * The code is requested as soon as this is shown; "New code" asks again.
 */
export function HeadsetShare() {
  const { service, target, warning } = useMemo(() => {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      // Blocked storage: the token is only taken from the URL.
    }
    const token = sessionToken(window.location.search, storage);
    return {
      service: pairingService(window.location.search),
      target: headsetLink(window.location.href, token),
      warning: linkWarning(window.location.href, token),
    };
  }, []);

  const [state, setState] = useState<PairingState>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  // A code that arrives for a superseded request is dropped.
  const requestRef = useRef(0);

  const expiresAt = state.status === "ready" ? state.pairing.expiresAt : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const pair = useCallback(async () => {
    const request = ++requestRef.current;
    setState({ status: "loading" });
    try {
      const pairing = await requestPairingCode(service, target);
      if (request !== requestRef.current) return;
      setNow(Date.now());
      setState({ status: "ready", pairing });
    } catch (error) {
      if (request !== requestRef.current) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [service, target]);

  useEffect(() => {
    pair();
    return () => {
      requestRef.current++; // drop a code that arrives after unmount
    };
  }, [pair]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(target);
      setCopied("Copied");
    } catch {
      setCopied("Press Ctrl+C");
    }
    setTimeout(() => setCopied(null), 1800);
  };

  const expired = expiresAt !== null && expiresAt <= now;

  return (
    <div className="space-y-2 rounded bg-white/5 p-2">
      <div className="text-xs font-semibold text-zinc-300">Open on a headset</div>

      <div className="text-center">
        <div className="text-xs text-zinc-400">
          In the headset&apos;s browser open{" "}
          <span className="font-mono text-sky-400">{typedAddress(service)}</span> and enter
        </div>
        <div
          className={`my-1 font-mono text-4xl font-bold tracking-[0.4em] ${
            expired ? "text-zinc-500 line-through" : "text-white"
          }`}
        >
          {state.status === "ready"
            ? state.pairing.code
            : state.status === "loading"
              ? "····"
              : "––––"}
        </div>
        <div className={`text-xs ${state.status === "error" ? "text-red-400" : "text-zinc-500"}`}>
          {state.status === "loading"
            ? `asking ${typedAddress(service)} for a code…`
            : state.status === "error"
              ? `No pairing code: ${state.message}`
              : expiresAt === null
                ? ""
                : expired
                  ? "this code has expired"
                  : `valid for ${formatRemaining(expiresAt - now)}`}
        </div>
      </div>

      <button
        onClick={pair}
        disabled={state.status === "loading"}
        className="rounded bg-sky-500/80 px-3 py-1 text-xs hover:bg-sky-500 disabled:opacity-50"
      >
        ↻ New code
      </button>

      <div className="flex gap-1">
        <input
          readOnly
          value={target}
          onFocus={(event) => event.target.select()}
          className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
        />
        <button
          onClick={copy}
          className="rounded bg-zinc-700/80 px-2 py-1 text-xs hover:bg-zinc-600"
        >
          {copied ?? "Copy"}
        </button>
      </div>

      {warning && <div className="text-xs text-yellow-300">{warning}</div>}
    </div>
  );
}
