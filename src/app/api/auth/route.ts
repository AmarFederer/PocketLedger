import { z } from "zod";
import { appMode } from "@/lib/config";
import { supabaseServer } from "@/lib/supabase/server";

const credentials = z.object({ email: z.email(), password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (appMode(process.env) !== "cloud") return Response.json({ error: "Authentication is not configured." }, { status: 503 });
  try {
    const raw = await request.json();
    const { action } = z.object({ action: z.enum(["signin", "signup", "forgot", "reset", "signout"]) }).parse(raw);
    const client = await supabaseServer();
    const callback = `${new URL(request.url).origin}/auth/callback`;
    if (action === "signin") {
      const result = await client.auth.signInWithPassword(credentials.parse(raw));
      if (result.error || !result.data.user.email_confirmed_at) return Response.json({ error: "Unable to sign in. Check your credentials and verify your email." }, { status: 401 });
    } else if (action === "signup") {
      const input = credentials.extend({ password: z.string().min(12).max(128), name: z.string().trim().min(1).max(60) }).parse(raw);
      const result = await client.auth.signUp({ email: input.email, password: input.password, options: { data: { display_name: input.name }, emailRedirectTo: callback } });
      if (result.error) return Response.json({ error: "Signup is unavailable. Check the details or try later." }, { status: 400 });
    } else if (action === "forgot") {
      const input = z.object({ email: z.email() }).parse(raw);
      await client.auth.resetPasswordForEmail(input.email, { redirectTo: `${callback}?next=reset-password` });
    } else if (action === "reset") {
      const { password } = z.object({ password: z.string().min(12).max(128) }).parse(raw);
      const { data: { user } } = await client.auth.getUser();
      if (!user) return Response.json({ error: "Reset session expired. Request another email." }, { status: 401 });
      const result = await client.auth.updateUser({ password });
      if (result.error) return Response.json({ error: "Password update failed." }, { status: 400 });
    } else {
      const result = await client.auth.signOut();
      if (result.error) return Response.json({ error: "Sign-out failed. Try again." }, { status: 503 });
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Invalid request or authentication unavailable." }, { status: 400 }); }
}