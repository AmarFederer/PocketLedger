import { notFound, redirect } from "next/navigation";
import { appMode } from "@/lib/config";
import { demoLedger } from "@/lib/ledger";
import { cloudLedger } from "@/lib/supabase/ledger";
import { SetupScreen } from "@/components/setup-screen";
import { AuthScreen, type AuthView } from "@/features/auth-screen";
import { LedgerApp, type View } from "@/features/ledger-app";

export const dynamic = "force-dynamic";
const views = ["dashboard", "expenses", "budgets", "reports", "settings", "onboarding"];
const authViews = ["sign-in", "sign-up", "forgot-password", "reset-password"];

export default async function Page({ params, searchParams }: { params: Promise<{ view: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { view } = await params;
  const { notice } = await searchParams;
  if (![...views, ...authViews].includes(view)) notFound();
  const mode = appMode(process.env);
  if (mode === "unconfigured") return <SetupScreen />;
  if (authViews.includes(view)) {
    if (mode === "demo") redirect("/dashboard");
    return <AuthScreen view={view as AuthView} notice={notice} />;
  }
  const initial = mode === "demo" ? demoLedger() : await cloudLedger();
  if (!initial.profile.onboarded && view !== "onboarding") redirect("/onboarding");
  return <LedgerApp initial={initial} mode={mode} view={view as View} />;
}