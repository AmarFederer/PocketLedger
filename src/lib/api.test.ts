import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoLedger } from "./ledger";

const provider = vi.hoisted(() => ({
  server: vi.fn(),
  rpc: vi.fn(),
  auth: {
    getUser: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(),
  },
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: provider.server }));

import { POST as authenticate } from "@/app/api/auth/route";
import { GET as readLedger, POST as writeLedger } from "@/app/api/ledger/route";

const origin = "https://ledger.example";
function request(path: string, body: unknown) {
  return new Request(`${origin}${path}`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function mutation() {
  return { key: "33333333-3333-4333-8333-333333333333", revision: 0, issuedAt: new Date().toISOString(), change: { type: "deleteExpense", id: demoLedger().expenses[0].id, version: 1 } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("POCKETLEDGER_DEMO", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-test-key");
  provider.server.mockResolvedValue({ auth: provider.auth, rpc: provider.rpc });
  provider.auth.getUser.mockResolvedValue({ data: { user: { email_confirmed_at: "2026-01-01" } }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("authentication failure handling", () => {
  it.each([500, 400, 429])("reports recovery provider failures safely (%s)", async (status) => {
    provider.auth.resetPasswordForEmail.mockResolvedValue({ error: { status, code: "provider_error", message: "secret provider details synthetic@example.com" } });
    const response = await authenticate(request("/api/auth", { action: "forgot", email: "synthetic@example.com" }));
    expect(response.status).toBe(status === 429 ? 429 : 503);
    expect(await response.json()).toEqual({ error: "Password recovery is temporarily unavailable. Try again later." });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("synthetic@example.com");
  });
  it("preserves generic recovery success without claiming account existence", async () => {
    provider.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    const response = await authenticate(request("/api/auth", { action: "forgot", email: "synthetic@example.com" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
  it("rejects invalid input before calling recovery", async () => {
    const response = await authenticate(request("/api/auth", { action: "forgot", email: "not-email" }));
    expect(response.status).toBe(400);
    expect(provider.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it.each([undefined, 503, 429, 400])("distinguishes sign-in availability from credentials (%s)", async (status) => {
    provider.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { status, code: "auth_failure" } });
    const response = await authenticate(request("/api/auth", { action: "signin", email: "synthetic@example.com", password: "synthetic-password" }));
    expect(response.status).toBe(status === 429 ? 429 : status === 400 ? 401 : 503);
  });
  it("does not classify unexpected infrastructure exceptions as bad input", async () => {
    provider.server.mockRejectedValue(new Error("private token"));
    const response = await authenticate(request("/api/auth", { action: "forgot", email: "synthetic@example.com" }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private token");
  });
});

describe("ledger API response contracts", () => {
  it("returns successful validated snapshots", async () => {
    provider.rpc.mockResolvedValue({ data: demoLedger(), error: null });
    expect((await readLedger()).status).toBe(200);
    expect((await writeLedger(request("/api/ledger", mutation()))).status).toBe(200);
  });
  it.each([
    ["P0001", "stale ledger revision", 409],
    ["P0001", "idempotency payload conflict", 409],
    ["P0001", "mutation rate exceeded", 429],
    ["P0001", "invalid allocations", 400],
    ["P0001", "invalid change payload", 400],
    ["23514", "constraint failed", 400],
    ["23505", "duplicate category", 409],
    ["42501", "verified authentication required", 401],
    ["08006", "private database error", 503],
    ["P0001", "unknown internal failure", 503],
  ])("classifies %s %s as %s", async (code, message, status) => {
    provider.rpc.mockResolvedValue({ data: null, error: { code, message } });
    const response = await writeLedger(request("/api/ledger", mutation()));
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private database error");
  });
  it("rejects invalid request data without calling the service", async () => {
    expect((await writeLedger(request("/api/ledger", {}))).status).toBe(400);
    expect(provider.server).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    const input = new Request(`${origin}/api/ledger`, { method: "POST", headers: { origin }, body: "{" });
    expect((await writeLedger(input)).status).toBe(400);
  });
  it.each([readLedger, () => writeLedger(request("/api/ledger", mutation()))])("handles invalid service snapshots as infrastructure failures", async (invoke) => {
    provider.rpc.mockResolvedValue({ data: { malformed: true }, error: null });
    expect((await invoke()).status).toBe(503);
  });
  it.each([readLedger, () => writeLedger(request("/api/ledger", mutation()))])("does not label authentication outages as expired sessions", async (invoke) => {
    provider.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503, code: "unavailable" } });
    expect((await invoke()).status).toBe(503);
  });
  it("handles a thrown snapshot failure with a JSON response", async () => {
    provider.rpc.mockRejectedValue(new Error("private infrastructure details"));
    const response = await readLedger();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Ledger temporarily unavailable. Try again later." });
  });
});
