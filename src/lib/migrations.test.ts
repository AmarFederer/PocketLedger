import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerSchema, type Ledger } from "./ledger";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
let categoryId: string;
let revision = 0;

async function mutate(change: unknown, key = randomUUID(), expectedRevision = revision) {
  const result = await db.query<{ ledger: Ledger }>("select public.apply_ledger_change($1::uuid, $2::integer, now(), $3::jsonb) as ledger", [key, expectedRevision, JSON.stringify(change)]);
  const ledger = ledgerSchema.parse(result.rows[0].ledger);
  revision = ledger.revision;
  return ledger;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const file of ["202610020001_initial_ledger.sql", "202610020002_default_rupees.sql", "202610020003_validate_mutations.sql"]) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.query("insert into auth.users values ($1, now(), '{}'::jsonb), ($2, now(), '{}'::jsonb)", [owner, other]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  const initial = await db.query<{ id: string }>("select id from public.categories where user_id = $1 order by name limit 1", [owner]);
  categoryId = initial.rows[0].id;
  await mutate({ type: "saveProfile", profile: { name: "Synthetic SQL Test", currency: "INR", timeZone: "UTC", currencyLocked: false, onboarded: true } });
}, 30000);

afterAll(async () => { await db?.close(); });

describe("forward migration mutation validation", () => {
  it("preserves allocations after malformed budget requests", async () => {
    const month = "2026-10";
    const baseline = await mutate({ type: "saveBudget", budget: { month, limit: 10000, allocations: { [categoryId]: 5000 } } });
    for (const allocations of [undefined, null, [], "invalid", { [categoryId]: "100" }, { [categoryId]: null }]) {
      await expect(mutate({ type: "saveBudget", budget: { month, limit: 10000, allocations } })).rejects.toThrow();
      const snapshot = await db.query<{ ledger: Ledger }>("select public.ledger_snapshot() as ledger");
      expect(snapshot.rows[0].ledger).toEqual(baseline);
    }
    const cleared = await mutate({ type: "saveBudget", budget: { month, limit: 10000, allocations: {} } });
    expect(cleared.budgets[0].allocations).toEqual({});
  });
  it("rejects missing, null, and wrongly typed expense versions without changing records", async () => {
    const expense = { id: randomUUID(), categoryId, amount: 100, date: "2026-01-01", merchant: "Synthetic merchant", note: "", version: 1 };
    const baseline = await mutate({ type: "saveExpense", expense });
    for (const version of [undefined, null, "1", 0, 1.5]) {
      await expect(mutate({ type: "saveExpense", expense: { ...expense, amount: 999, version } })).rejects.toThrow();
      const snapshot = await db.query<{ ledger: Ledger }>("select public.ledger_snapshot() as ledger");
      expect(snapshot.rows[0].ledger).toEqual(baseline);
    }
    const updated = await mutate({ type: "saveExpense", expense: { ...expense, amount: 200 } });
    expect(updated.expenses.find((item) => item.id === expense.id)?.version).toBe(2);
  });
  it.each([null, [], {}, { type: "deleteBudget" }, { type: "deleteExpense", id: randomUUID() }, { type: "saveCategory", category: { id: randomUUID(), name: "Broken", color: "#287c62" } }])("rejects malformed changes %j", async (change) => {
    await expect(mutate(change)).rejects.toThrow();
  });
  it("keeps idempotent retries and stale revision checks intact", async () => {
    const key = randomUUID();
    const oldRevision = revision;
    const change = { type: "saveBudget", budget: { month: "2026-11", limit: 20000, allocations: {} } };
    const saved = await mutate(change, key);
    expect(await mutate(change, key, oldRevision)).toEqual(saved);
    await expect(mutate({ ...change, budget: { ...change.budget, limit: 30000 } }, key)).rejects.toThrow("idempotency payload conflict");
    await expect(mutate(change, randomUUID(), oldRevision)).rejects.toThrow("stale ledger revision");
  });
  it("rejects another user's category", async () => {
    const category = await db.query<{ id: string }>("select id from public.categories where user_id = $1 limit 1", [other]);
    await expect(mutate({ type: "saveBudget", budget: { month: "2026-12", limit: 1000, allocations: { [category.rows[0].id]: 100 } } })).rejects.toThrow("inactive allocation category");
  });
});
