"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applyChange, changeSchema, demoLedger, ledgerSchema, type Change, type Ledger } from "@/lib/ledger";

const storageKey = "pocketledger.synthetic-demo.v1";

function readDemo(fallback: Ledger) {
  const text = localStorage.getItem(storageKey);
  const saved = text ? ledgerSchema.parse(JSON.parse(text)) : fallback;
  if (saved.profile.currency === "USD") {
    saved.profile.currency = "INR";
    localStorage.setItem(storageKey, JSON.stringify(saved));
  }
  return saved;
}

export function useLedger(initial: Ledger, mode: "demo" | "cloud") {
  const router = useRouter();
  const [ledger, setLedger] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const lastRequest = useRef<{ fingerprint: string; key: string; issuedAt: string } | null>(null);

  function expiredSession() {
    lastRequest.current = null;
    setLedger({ ...initial, expenses: [], budgets: [], categories: [], profile: { ...initial.profile, name: "", onboarded: false } });
    router.replace("/sign-in");
    router.refresh();
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (mode === "demo" && active) setLedger(readDemo(initial));
      } catch {
        if (active) setError("Demo storage could not be read. Clear the demo in Settings or allow browser storage.");
      }
    }
    const synchronize = () => { void load(); };
    void load();
    window.addEventListener("storage", synchronize);
    return () => { active = false; window.removeEventListener("storage", synchronize); };
  }, [initial, mode]);

  async function mutate(change: Change) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const parsed = changeSchema.parse(change);
      let next: Ledger;
      if (mode === "demo") {
        if (!navigator.locks) throw new Error("This browser does not support safe demo writes. Use a current browser.");
        next = await navigator.locks.request(storageKey, () => {
          const current = readDemo(ledger);
          const result = applyChange(current, parsed, ledger.revision);
          localStorage.setItem(storageKey, JSON.stringify(result));
          return result;
        });
      } else {
        const fingerprint = JSON.stringify({ revision: ledger.revision, change: parsed });
        if (lastRequest.current?.fingerprint !== fingerprint) lastRequest.current = { fingerprint, key: crypto.randomUUID(), issuedAt: new Date().toISOString() };
        const response = await fetch("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: lastRequest.current.key, issuedAt: lastRequest.current.issuedAt, revision: ledger.revision, change: parsed }) });
        const result = await response.json();
        if (response.status === 401) expiredSession();
        if (!response.ok) throw new Error(result.error ?? "Could not save changes.");
        next = ledgerSchema.parse(result);
        lastRequest.current = null;
      }
      setLedger(next);
      return true;
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save changes.");
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function reload() {
    try {
      if (mode === "demo") setLedger(readDemo(initial));
      else {
        const response = await fetch("/api/ledger", { cache: "no-store" });
        if (response.status === 401) expiredSession();
        if (!response.ok) throw new Error("Session expired or ledger unavailable. Sign in again.");
        setLedger(ledgerSchema.parse(await response.json()));
      }
      lastRequest.current = null;
      setError("");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Reload failed.");
    }
  }

  function resetDemo() {
    try {
      localStorage.removeItem(storageKey);
      setLedger(demoLedger());
      setError("");
      return true;
    } catch { setError("Browser storage could not be cleared."); return false; }
  }

  return { ledger, mutate, pending, error, setError, reload, resetDemo };
}