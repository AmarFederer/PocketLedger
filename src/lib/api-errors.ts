import { z } from "zod";

export function apiError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function logServiceError(operation: string, issue: unknown) {
  const code = typeof issue === "object" && issue !== null && "code" in issue && typeof issue.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(issue.code) ? issue.code : "unknown";
  console.error("PocketLedger service failure", { operation, code });
}

export async function parseRequest(request: Request) {
  try {
    return await request.json();
  } catch (issue) {
    if (issue instanceof SyntaxError) throw new InvalidJsonError();
    throw issue;
  }
}

export class InvalidJsonError extends Error {}

export function invalidRequest(issue: unknown) {
  return issue instanceof z.ZodError || issue instanceof InvalidJsonError;
}

export function ledgerMutationError(issue: { code?: string; message: string }) {
  if (issue.code === "42501") return apiError("Sign in with a verified account.", 401);
  if (issue.code === "P0001") {
    if (issue.message === "mutation rate exceeded") return apiError("Too many changes. Try again in a minute.", 429);
    if (["stale ledger revision", "stale expense", "stale or missing expense", "idempotency payload conflict", "expired request", "invalid or expired request"].includes(issue.message)) {
      return apiError("Save failed or data changed. Reload and check your records before trying again.", 409);
    }
    if (["inactive category", "invalid expense date", "complete onboarding", "invalid month", "invalid allocations", "invalid allocation", "inactive allocation category", "allocations exceed overall budget", "invalid category ownership", "currency locked", "invalid time zone", "unknown change", "invalid change payload"].includes(issue.message)) {
      return apiError("Invalid ledger data. Check the details and try again.", 400);
    }
  }
  if (issue.code === "23505") return apiError("A record with these details already exists. Reload and check your records.", 409);
  if (issue.code?.startsWith("22") || ["23502", "23503", "23514"].includes(issue.code ?? "")) {
    return apiError("Invalid ledger data. Check the details and try again.", 400);
  }
  logServiceError("ledger.mutate", issue);
  return apiError("Ledger temporarily unavailable. Retry the same change or reload to check its status.", 503);
}
