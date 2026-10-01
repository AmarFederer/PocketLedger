import { z } from "zod";
import { appMode } from "@/lib/config";
import { supabaseServer } from "@/lib/supabase/server";
import { apiError, invalidRequest, logServiceError, parseRequest } from "@/lib/api-errors";

const credentials = z.object({ email: z.email(), password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (appMode(process.env) !== "cloud") return Response.json({ error: "Authentication is not configured." }, { status: 503 });
  try {
    const raw = await parseRequest(request);
    const { action } = z.object({ action: z.enum(["signin", "signup", "forgot", "reset", "signout"]) }).parse(raw);
    const client = await supabaseServer();
    const callback = `${new URL(request.url).origin}/auth/callback`;
    if (action === "signin") {
      const result = await client.auth.signInWithPassword(credentials.parse(raw));
      if (result.error && (!result.error.status || result.error.status >= 500)) {
        logServiceError("auth.signin", result.error);
        return apiError("Authentication temporarily unavailable. Try again later.", 503);
      }
      if (result.error?.status === 429) return apiError("Too many attempts. Try again later.", 429);
      if (result.error || !result.data.user?.email_confirmed_at) return apiError("Unable to sign in. Check your credentials and verify your email.", 401);
    } else if (action === "signup") {
      const input = credentials.extend({ password: z.string().min(12).max(128), name: z.string().trim().min(1).max(60) }).parse(raw);
      const result = await client.auth.signUp({ email: input.email, password: input.password, options: { data: { display_name: input.name }, emailRedirectTo: callback } });
      if (result.error) {
        logServiceError("auth.signup", result.error);
        return apiError("Signup is unavailable. Check the details or try later.", result.error.status === 429 ? 429 : !result.error.status || result.error.status >= 500 ? 503 : 400);
      }
    } else if (action === "forgot") {
      const input = z.object({ email: z.email() }).parse(raw);
      const result = await client.auth.resetPasswordForEmail(input.email, { redirectTo: `${callback}?next=reset-password` });
      if (result.error) {
        logServiceError("auth.recovery", result.error);
        return apiError("Password recovery is temporarily unavailable. Try again later.", result.error.status === 429 ? 429 : 503);
      }
    } else if (action === "reset") {
      const { password } = z.object({ password: z.string().min(12).max(128) }).parse(raw);
      const { data: { user }, error } = await client.auth.getUser();
      if (error && (!error.status || error.status >= 500)) {
        logServiceError("auth.reset-session", error);
        return apiError("Authentication temporarily unavailable. Try again later.", 503);
      }
      if (!user) return Response.json({ error: "Reset session expired. Request another email." }, { status: 401 });
      const result = await client.auth.updateUser({ password });
      if (result.error) {
        logServiceError("auth.reset", result.error);
        return apiError("Password update failed. Try again later.", result.error.status === 429 ? 429 : !result.error.status || result.error.status >= 500 ? 503 : 400);
      }
    } else {
      const result = await client.auth.signOut();
      if (result.error) {
        logServiceError("auth.signout", result.error);
        return apiError("Sign-out failed. Try again.", 503);
      }
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (issue) {
    if (invalidRequest(issue)) return apiError("Invalid authentication request. Check the details.", 400);
    logServiceError("auth.request", issue);
    return apiError("Authentication temporarily unavailable. Try again later.", 503);
  }
}