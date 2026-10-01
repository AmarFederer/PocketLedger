import { describe, expect, it } from "vitest";
import { applyChange, decimalMoney, demoLedger, exportCsv, filterExpenses, formatMoney, parseMoney, sumAmounts, todayInZone, validDate } from "./ledger";

const now = new Date("2026-10-02T12:00:00Z");

describe("exact money", () => {
  it("defaults to rupees and formats amounts with Indian grouping", () => {
    expect(demoLedger(now).profile.currency).toBe("INR");
    expect(formatMoney(12345678, "INR")).toBe("\u20b91,23,456.78");
    expect(formatMoney(0, "INR")).toBe("\u20b90.00");
    expect(formatMoney(-1234, "INR")).toBe("-\u20b912.34");
  });
  it("parses decimal text without floating-point arithmetic", () => {
    expect(parseMoney("0.29", "USD")).toBe(29);
    expect(parseMoney("12.1", "INR")).toBe(1210);
    expect(parseMoney("250", "JPY")).toBe(250);
    expect(decimalMoney(29, "USD")).toBe("0.29");
    expect(decimalMoney(250, "JPY")).toBe("250");
    expect(sumAmounts([10, 20])).toBe(30);
  });
  it.each(["0", "-2", "1.001", "1e3", "NaN", "10000001", "", ".5"])("rejects invalid USD amount %s", (input) => expect(() => parseMoney(input, "USD")).toThrow());
  it("rejects JPY fractions and unsafe sums", () => {
    expect(() => parseMoney("1.0", "JPY")).toThrow();
    expect(() => sumAmounts([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
});

describe("dates and financial rules", () => {
  it("validates real calendar dates and timezone boundaries", () => {
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2026-02-29")).toBe(false);
    expect(validDate("2026-13-01")).toBe(false);
    expect(todayInZone("America/Los_Angeles", new Date("2026-10-02T01:00:00Z"))).toBe("2026-10-01");
  });
  it("rejects future expenses and stale ledgers", () => {
    const state = demoLedger(now);
    expect(() => applyChange(state, { type: "saveExpense", expense: { ...state.expenses[0], date: "2026-10-03" } }, 0, now)).toThrow("future");
    expect(() => applyChange(state, { type: "deleteExpense", id: state.expenses[0].id, version: 1 }, 1, now)).toThrow("another tab");
  });
  it("locks currency after deleting records", () => {
    const state = demoLedger(now);
    state.expenses = [];
    state.budgets = [];
    expect(() => applyChange(state, { type: "saveProfile", profile: { ...state.profile, currency: "EUR" } }, 0, now)).toThrow("locked");
  });
  it("enforces allocations and keeps expenses when budgets are removed", () => {
    const state = demoLedger(now);
    expect(() => applyChange(state, { type: "saveBudget", budget: { ...state.budgets[0], limit: 100 } }, 0)).toThrow("allocations");
    const next = applyChange(state, { type: "deleteBudget", month: "2026-10" }, 0);
    expect(next.budgets).toHaveLength(0);
    expect(next.expenses).toHaveLength(state.expenses.length);
  });
  it("preserves an archived category on an unrelated edit", () => {
    const state = demoLedger(now);
    state.categories[0].archived = true;
    expect(applyChange(state, { type: "saveExpense", expense: { ...state.expenses[0], note: "Updated" } }, 0, now).expenses.find((item) => item.id === state.expenses[0].id)?.version).toBe(2);
    expect(() => applyChange(state, { type: "saveExpense", expense: { ...state.expenses[0], id: "20000000-0000-4000-8000-000000000001" } }, 0, now)).toThrow("active category");
  });
});

describe("filtering and CSV", () => {
  it("exports all matches with precise amounts and safely quoted text", () => {
    const state = demoLedger(now);
    state.expenses[0].merchant = '=HYPERLINK("bad")';
    const csv = exportCsv(state, filterExpenses(state, { month: "2026-10" }));
    expect(csv).toContain("' =".replace(" ", ""));
    expect(csv).toContain('"86.42"');
    expect(csv).toContain('"INR"');
    expect(csv).not.toContain('"USD"');
    expect(csv).toContain('""bad""');
    expect(csv.split("\r\n")).toHaveLength(11);
  });
  it("combines date, category and case-insensitive search filters", () => {
    const state = demoLedger(now);
    expect(filterExpenses(state, { search: "COFFEE", category: state.categories[0].id, from: "2026-10-01", to: "2026-10-02" })).toHaveLength(1);
    expect(filterExpenses(state, { month: "2026-11" })).toHaveLength(0);
  });
});