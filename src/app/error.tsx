"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="setup-page"><main className="setup-panel"><h1>Ledger unavailable</h1><p className="muted">The connection or database setup could not be verified.</p><button className="button primary" onClick={reset}>Try again</button></main></div>;
}