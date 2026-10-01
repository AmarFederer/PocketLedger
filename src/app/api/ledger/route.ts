import { z } from "zod";
import { appMode } from "@/lib/config";
import { changeSchema, ledgerSchema } from "@/lib/ledger";
import { supabaseServer } from "@/lib/supabase/server";

const requestSchema = z.object({ key: z.uuid(), revision: z.number().int().nonnegative(), issuedAt: z.iso.datetime(), change: changeSchema });

export async function GET() {
  if (appMode(process.env) !== "cloud") return Response.json({ error: "Cloud ledger is not configured." }, { status: 503 });
  const client = await supabaseServer();
  const { data: { user } } = await client.auth.getUser();
  if (!user?.email_confirmed_at) return Response.json({ error: "Sign in with a verified account." }, { status: 401 });
  const result = await client.rpc("ledger_snapshot");
  if (result.error) return Response.json({ error: "Ledger unavailable." }, { status: 503 });
  return Response.json(ledgerSchema.parse(result.data), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (appMode(process.env) !== "cloud") return Response.json({ error: "Cloud ledger is not configured." }, { status: 503 });
  try {
    const input = requestSchema.parse(await request.json());
    const client = await supabaseServer();
    const { data: { user } } = await client.auth.getUser();
    if (!user?.email_confirmed_at) return Response.json({ error: "Your session expired. Sign in again." }, { status: 401 });
    const result = await client.rpc("apply_ledger_change", { p_key: input.key, p_revision: input.revision, p_issued_at: input.issuedAt, p_change: input.change });
    if (result.error) return Response.json({ error: result.error.message.includes("rate") ? "Too many changes. Try again in a minute." : "Save failed or data changed. Reload and try again." }, { status: result.error.message.includes("rate") ? 429 : 409 });
    return Response.json(ledgerSchema.parse(result.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "Invalid ledger data or save unavailable." }, { status: 409 }); }
}