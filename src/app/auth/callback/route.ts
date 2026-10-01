import { NextResponse } from "next/server";
import { appMode } from "@/lib/config";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (appMode(process.env) !== "cloud") return NextResponse.redirect(new URL("/", url.origin));
  const code = url.searchParams.get("code");
  if (code) {
    const client = await supabaseServer();
    const result = await client.auth.exchangeCodeForSession(code);
    if (!result.error) return NextResponse.redirect(new URL(url.searchParams.get("next") === "reset-password" ? "/reset-password" : "/dashboard", url.origin));
  }
  return NextResponse.redirect(new URL("/sign-in?notice=callback", url.origin));
}