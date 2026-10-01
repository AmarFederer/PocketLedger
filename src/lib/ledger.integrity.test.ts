import { describe, expect, it } from "vitest";
import { demoLedger, ledgerSchema } from "./ledger";

describe("ledger snapshot integrity", () => {
  it("accepts existing synthetic snapshots in each supported currency", () => {
    for (const currency of ["INR", "USD", "EUR", "GBP", "JPY"] as const) {
      const ledger = demoLedger();
      ledger.profile.currency = currency;
      expect(ledgerSchema.safeParse(ledger).success).toBe(true);
    }
  });
  it.each(["expense-category", "allocation-category", "allocations", "category-id", "category-name", "expense-id", "budget-month", "currency-lock"])("rejects %s corruption", (kind) => {
    const ledger = demoLedger();
    const missing = "99999999-9999-4999-8999-999999999999";
    if (kind === "expense-category") ledger.expenses[0].categoryId = missing;
    if (kind === "allocation-category") ledger.budgets[0].allocations[missing] = 1;
    if (kind === "allocations") ledger.budgets[0].limit = 1;
    if (kind === "category-id") ledger.categories.push({ ...ledger.categories[0], name: "Duplicate ID" });
    if (kind === "category-name") ledger.categories[1].name = ledger.categories[0].name.toUpperCase();
    if (kind === "expense-id") ledger.expenses.push({ ...ledger.expenses[0] });
    if (kind === "budget-month") ledger.budgets.push({ ...ledger.budgets[0] });
    if (kind === "currency-lock") ledger.profile.currencyLocked = false;
    expect(ledgerSchema.safeParse(ledger).success).toBe(false);
  });
});
