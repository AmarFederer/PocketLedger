import { Settings, Wallet } from "lucide-react";

export function SetupScreen() {
  return <div className="setup-page"><div className="brand"><span className="brand-mark"><Wallet size={22} /></span>PocketLedger</div><main className="setup-panel"><Settings size={30} color="#287c62" /><h1>Connection not configured</h1><p className="muted">The ledger is unavailable until its database connection is configured.</p></main></div>;
}