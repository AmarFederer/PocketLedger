import { redirect } from "next/navigation";
import { ledgerSchema } from "@/lib/ledger";
import { supabaseServer } from "./server";

export async function cloudLedger() {
  const client = await supabaseServer();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect("/sign-in");
  if (!user.email_confirmed_at) redirect("/sign-in?notice=verify");
  const result = await client.rpc("ledger_snapshot");
  if (result.error) throw new Error("Ledger unavailable. Apply the database migration and retry.");
  return ledgerSchema.parse(result.data);
}