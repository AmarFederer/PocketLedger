import { z } from "zod";
import { appMode } from "@/lib/config";
import { changeSchema, ledgerSchema } from "@/lib/ledger";
import { supabaseServer } from "@/lib/supabase/server";
import { apiError, invalidRequest, ledgerMutationError, logServiceError, parseRequest } from "@/lib/api-errors";

const requestSchema = z.object({ key: z.uuid(), revision: z.number().int().nonnegative(), issuedAt: z.iso.datetime(), change: changeSchema });

export async function GET() {
  if (appMode(process.env) !== "cloud") return Response.json({ error: "Cloud ledger is not configured." }, { status: 503 });
  try {
    const client = await supabaseServer();
    const { data: { user }, error } = await client.auth.getUser();
    if (error && (!error.status || error.status >= 500)) {
      logServiceError("ledger.session", error);
      return apiError("Authentication temporarily unavailable. Try again later.", 503);
    }
    if (!user?.email_confirmed_at) return apiError("Sign in with a verified account.", 401);
    const result = await client.rpc("ledger_snapshot");
    if (result.error) {
      logServiceError("ledger.snapshot", result.error);
      return apiError("Ledger temporarily unavailable. Try again later.", 503);
    }
    return Response.json(ledgerSchema.parse(result.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (issue) {
    logServiceError("ledger.snapshot", issue);
    return apiError("Ledger temporarily unavailable. Try again later.", 503);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (appMode(process.env) !== "cloud") return Response.json({ error: "Cloud ledger is not configured." }, { status: 503 });
  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await parseRequest(request));
  } catch (issue) {
    if (invalidRequest(issue)) return apiError("Invalid ledger request. Check the details.", 400);
    logServiceError("ledger.request", issue);
    return apiError("Ledger temporarily unavailable. Try again later.", 503);
  }
  try {
    const client = await supabaseServer();
    const { data: { user }, error } = await client.auth.getUser();
    if (error && (!error.status || error.status >= 500)) {
      logServiceError("ledger.session", error);
      return apiError("Authentication temporarily unavailable. Try again later.", 503);
    }
    if (!user?.email_confirmed_at) return Response.json({ error: "Your session expired. Sign in again." }, { status: 401 });
    const result = await client.rpc("apply_ledger_change", { p_key: input.key, p_revision: input.revision, p_issued_at: input.issuedAt, p_change: input.change });
    if (result.error) return ledgerMutationError(result.error);
    return Response.json(ledgerSchema.parse(result.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (issue) {
    logServiceError("ledger.mutate", issue);
    return apiError("Ledger temporarily unavailable. Retry the same change or reload to check its status.", 503);
  }
}