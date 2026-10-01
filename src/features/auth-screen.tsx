"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wallet } from "lucide-react";

export type AuthView = "sign-in" | "sign-up" | "forgot-password" | "reset-password";
const labels: Record<AuthView, { title: string; button: string; action: string }> = { "sign-in": { title: "Welcome back", button: "Sign in", action: "signin" }, "sign-up": { title: "Create your account", button: "Create account", action: "signup" }, "forgot-password": { title: "Reset your password", button: "Send reset email", action: "forgot" }, "reset-password": { title: "Choose a new password", button: "Update password", action: "reset" } };

export function AuthScreen({ view, notice }: { view: AuthView; notice?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(notice === "verify" ? "Verify your email before signing in." : notice === "callback" ? "This link is invalid or expired. Request another email." : "");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: labels[view].action, email: fields.get("email"), password: fields.get("password"), name: fields.get("name") }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Authentication failed.");
      if (view === "sign-in" || view === "reset-password") { router.replace("/dashboard"); router.refresh(); }
      else setMessage(view === "sign-up" ? "Check your email to verify your account, then sign in." : "If an account exists, a password reset email has been sent.");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not connect."); } finally { setPending(false); }
  }
  return <div className="auth-page"><Link href="/" className="brand"><span className="brand-mark"><Wallet size={22} /></span>PocketLedger</Link><main className="auth-panel"><h1>{labels[view].title}</h1><form className="form-stack" onSubmit={submit}>{view === "sign-up" && <label>Name<input name="name" required maxLength={60} autoComplete="name" /></label>}{view !== "reset-password" && <label>Email<input name="email" type="email" required autoComplete="email" /></label>}{view !== "forgot-password" && <label>Password<input name="password" type="password" required minLength={view === "sign-in" ? 1 : 12} maxLength={128} autoComplete={view === "sign-in" ? "current-password" : "new-password"} /></label>}{error && <p role="alert" className="field-error">{error}</p>}{message && <p role="status" className="muted">{message}</p>}<button className="button primary" disabled={pending}>{pending ? "Please wait..." : labels[view].button}</button></form><div className="auth-links">{view === "sign-in" ? <><Link href="/sign-up">Create account</Link><Link href="/forgot-password">Forgot password?</Link></> : <Link href="/sign-in">Back to sign in</Link>}</div>{view === "sign-up" && <p className="muted small-text">Development release. Use synthetic data until privacy and operational requirements are approved.</p>}</main></div>;
}