export function appMode(env: Record<string, string | undefined>): "demo" | "cloud" | "unconfigured" {
  const hostedDemo = env.POCKETLEDGER_HOSTED_DEMO === "true"
    && !env.NEXT_PUBLIC_SUPABASE_URL
    && !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (env.POCKETLEDGER_DEMO === "true" && (env.NODE_ENV !== "production" || hostedDemo)) return "demo";
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return "cloud";
  return "unconfigured";
}