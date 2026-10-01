import { z } from "zod";

export const currencies = ["USD", "EUR", "GBP", "INR", "JPY"] as const;
export type Currency = (typeof currencies)[number];
export const MAX_AMOUNT = 1_000_000_000;
export const palette = ["#287c62", "#dc9846", "#4786b8", "#bd6a83", "#827ab4", "#707e88"];

export function precision(currency: Currency) {
  return currency === "JPY" ? 0 : 2;
}

export function parseMoney(input: string, currency: Currency): number {
  const trimmed = input.trim();
  const decimals = precision(currency);
  const pattern = decimals === 0 ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(trimmed)) throw new Error(`Enter a positive amount with at most ${decimals} decimal places.`);
  const [whole, fraction = ""] = trimmed.split(".");
  const minor = BigInt(whole) * BigInt(10 ** decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (minor <= 0 || minor > BigInt(MAX_AMOUNT)) throw new Error("Amount is outside the supported range.");
  return Number(minor);
}

export function decimalMoney(amount: number, currency: Currency) {
  if (!Number.isSafeInteger(amount)) throw new Error("Amount must be a safe integer.");
  const decimals = precision(currency);
  const factor = 10 ** decimals;
  const absolute = Math.abs(amount);
  return `${amount < 0 ? "-" : ""}${Math.floor(absolute / factor)}${decimals ? `.${String(absolute % factor).padStart(decimals, "0")}` : ""}`;
}

export function formatMoney(amount: number, currency: Currency) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: precision(currency) }).format(amount / 10 ** precision(currency));
}

export function sumAmounts(amounts: number[]) {
  return amounts.reduce((total, amount) => {
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total + amount)) throw new Error("Total exceeds the supported range.");
    return total + amount;
  }, 0);
}

export function todayInZone(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const amountSchema = z.number().int().positive().max(MAX_AMOUNT);
const categorySchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(40), color: z.enum(palette as [string, ...string[]]), archived: z.boolean() });
const expenseSchema = z.object({ id: z.uuid(), amount: amountSchema, date: z.string().refine(validDate, "Invalid date."), categoryId: z.uuid(), merchant: z.string().trim().min(1).max(100), note: z.string().trim().max(500), version: z.number().int().positive() });
const budgetSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).refine((value) => validDate(`${value}-01`)), limit: amountSchema, allocations: z.record(z.uuid(), amountSchema) });
const profileSchema = z.object({ name: z.string().trim().min(1).max(60), currency: z.enum(currencies), timeZone: z.string().refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }), currencyLocked: z.boolean(), onboarded: z.boolean() });
export const ledgerSchema = z.object({ revision: z.number().int().nonnegative(), profile: profileSchema, categories: z.array(categorySchema), expenses: z.array(expenseSchema), budgets: z.array(budgetSchema) });
export type Ledger = z.infer<typeof ledgerSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Budget = z.infer<typeof budgetSchema>;

export const changeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("saveExpense"), expense: expenseSchema }),
  z.object({ type: z.literal("deleteExpense"), id: z.uuid(), version: z.number().int().positive() }),
  z.object({ type: z.literal("saveBudget"), budget: budgetSchema }),
  z.object({ type: z.literal("deleteBudget"), month: z.string().regex(/^\d{4}-\d{2}$/) }),
  z.object({ type: z.literal("saveCategory"), category: categorySchema }),
  z.object({ type: z.literal("saveProfile"), profile: profileSchema }),
]);
export type Change = z.infer<typeof changeSchema>;

export function applyChange(state: Ledger, raw: Change, expectedRevision: number, now = new Date()): Ledger {
  const change = changeSchema.parse(raw);
  if (expectedRevision !== state.revision) throw new Error("This ledger changed in another tab. Reload and try again.");
  const next = structuredClone(state);
  if (change.type === "saveExpense") {
    const expense = change.expense;
    const old = state.expenses.find((item) => item.id === expense.id);
    const category = state.categories.find((item) => item.id === expense.categoryId);
    if (!category || (category.archived && old?.categoryId !== category.id)) throw new Error("Choose an active category.");
    if (expense.date > todayInZone(state.profile.timeZone, now)) throw new Error("Expense date cannot be in the future.");
    if (old && old.version !== expense.version) throw new Error("This expense changed. Reload and try again.");
    next.expenses = [...state.expenses.filter((item) => item.id !== expense.id), { ...expense, version: old ? old.version + 1 : 1 }];
    next.profile.currencyLocked = true;
  } else if (change.type === "deleteExpense") {
    const old = state.expenses.find((item) => item.id === change.id);
    if (!old || old.version !== change.version) throw new Error("This expense changed or was deleted. Reload and try again.");
    next.expenses = state.expenses.filter((item) => item.id !== change.id);
  } else if (change.type === "saveBudget") {
    const old = state.budgets.find((item) => item.month === change.budget.month);
    for (const [categoryId] of Object.entries(change.budget.allocations)) {
      const category = state.categories.find((item) => item.id === categoryId);
      if (!category || (category.archived && !old?.allocations[categoryId])) throw new Error("Choose an active category for new allocations.");
    }
    if (sumAmounts(Object.values(change.budget.allocations)) > change.budget.limit) throw new Error("Category allocations cannot exceed the overall budget.");
    next.budgets = [...state.budgets.filter((item) => item.month !== change.budget.month), change.budget];
    next.profile.currencyLocked = true;
  } else if (change.type === "deleteBudget") {
    next.budgets = state.budgets.filter((item) => item.month !== change.month);
  } else if (change.type === "saveCategory") {
    if (state.categories.some((item) => item.id !== change.category.id && item.name.toLowerCase() === change.category.name.toLowerCase())) throw new Error("A category with this name already exists.");
    next.categories = [...state.categories.filter((item) => item.id !== change.category.id), change.category];
  } else {
    if (state.profile.currencyLocked && change.profile.currency !== state.profile.currency) throw new Error("Currency is locked after financial records are created.");
    next.profile = { ...change.profile, currencyLocked: state.profile.currencyLocked };
  }
  next.revision += 1;
  return ledgerSchema.parse(next);
}

export type ExpenseFilters = { month?: string; category?: string; search?: string; from?: string; to?: string; sort?: "date" | "amount" };
export function filterExpenses(state: Ledger, filters: ExpenseFilters) {
  const search = filters.search?.trim().toLowerCase() ?? "";
  return state.expenses.filter((item) => (!filters.month || item.date.startsWith(filters.month)) && (!filters.category || item.categoryId === filters.category) && (!filters.from || item.date >= filters.from) && (!filters.to || item.date <= filters.to) && `${item.merchant} ${item.note}`.toLowerCase().includes(search)).sort((first, second) => (filters.sort === "amount" ? second.amount - first.amount : second.date.localeCompare(first.date)) || first.id.localeCompare(second.id));
}

export function exportCsv(state: Ledger, expenses: Expense[]) {
  const escape = (text: string) => `"${(/^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
  const rows = expenses.map((item) => [item.date, item.merchant, state.categories.find((category) => category.id === item.categoryId)?.name ?? "Archived", decimalMoney(item.amount, state.profile.currency), state.profile.currency, item.note]);
  return "\uFEFF" + [["Date", "Merchant", "Category", "Amount", "Currency", "Note"], ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

export function demoLedger(now = new Date()): Ledger {
  const date = todayInZone("UTC", now);
  const month = date.slice(0, 7);
  const categories: Category[] = ["Food & groceries", "Shopping", "Transport", "Home & bills", "Entertainment", "Health"].map((name, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name, color: palette[index], archived: false }));
  const entries: [string, number, number, string][] = [["Whole Foods Market", 8642, 0, "Weekly groceries"], ["Spotify", 1099, 4, "Monthly subscription"], ["Blue Bottle Coffee", 650, 0, "Morning coffee"], ["Uniqlo", 7990, 1, "Autumn essentials"], ["City Transit", 2450, 2, "Transit pass"], ["Internet bill", 6500, 3, "Monthly service"], ["Green Bowl", 1875, 0, "Lunch"], ["Bookshop", 3200, 4, "Weekend reading"], ["Pharmacy", 2190, 5, "Health supplies"], ["Farmers Market", 4230, 0, "Fresh produce"]];
  return { revision: 0, profile: { name: "Alex Morgan", currency: "INR", timeZone: "UTC", currencyLocked: true, onboarded: true }, categories, expenses: entries.map(([merchant, amount, category, note], index) => ({ id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, merchant, amount, categoryId: categories[category].id, note, date: `${month}-${String(Math.max(1, Number(date.slice(8)) - index)).padStart(2, "0")}`, version: 1 })), budgets: [{ month, limit: 180000, allocations: { [categories[0].id]: 50000, [categories[1].id]: 30000, [categories[2].id]: 15000, [categories[3].id]: 50000, [categories[4].id]: 20000, [categories[5].id]: 10000 } }] };
}