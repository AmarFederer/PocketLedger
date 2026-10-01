// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyChange, demoLedger, type Ledger } from "@/lib/ledger";
import { useLedger } from "./use-ledger";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
let root: Root;
let container: HTMLDivElement;
let observed: ReturnType<typeof useLedger> | undefined;
function Harness({ initial, mode }: { initial: Ledger; mode: "demo" | "cloud" }) {
  const result = useLedger(initial, mode);
  useEffect(() => { observed = result; }, [result]);
  return null;
}
function current() {
  if (!observed) throw new Error("Hook was not rendered");
  return observed;
}
async function render(initial: Ledger, mode: "demo" | "cloud" = "cloud") {
  await act(async () => { root.render(createElement(Harness, { initial, mode })); });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  observed = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("ledger hook synchronization", () => {
  it("loads saved USD data without modifying storage or relabelling amounts", async () => {
    const saved = demoLedger();
    saved.profile.currency = "USD";
    const encoded = JSON.stringify(saved);
    localStorage.setItem("pocketledger.synthetic-demo.v1", encoded);
    await render(demoLedger(), "demo");
    expect(current().ledger.profile.currency).toBe("USD");
    expect(current().ledger.expenses[0].amount).toBe(saved.expenses[0].amount);
    expect(localStorage.getItem("pocketledger.synthetic-demo.v1")).toBe(encoded);
  });
  it("adopts refreshed cloud snapshots", async () => {
    const initial = demoLedger();
    await render(initial);
    const refreshed = { ...initial, revision: 1, profile: { ...initial.profile, name: "Refreshed profile" } };
    await render(refreshed);
    expect(current().ledger).toEqual(refreshed);
  });
  it("defers refreshed snapshots during a mutation and adopts the newest revision afterward", async () => {
    const initial = demoLedger();
    await render(initial);
    let resolve: (value: Response) => void = () => { throw new Error("Request resolver not initialized"); };
    const response = new Promise<Response>((done) => { resolve = done; });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response));
    const change = { type: "deleteExpense", id: initial.expenses[0].id, version: 1 } as const;
    let pending: Promise<boolean> | undefined;
    await act(async () => { pending = current().mutate(change); });
    expect(current().pending).toBe(true);
    const refreshed = { ...initial, revision: 3, profile: { ...initial.profile, name: "Newest profile" } };
    await render(refreshed);
    expect(current().ledger).toEqual(initial);
    await act(async () => { resolve(Response.json(applyChange(initial, change, 0))); await pending; });
    expect(current().ledger).toEqual(refreshed);
  });
  it("does not overwrite a successful mutation with an older server snapshot", async () => {
    const initial = demoLedger();
    await render(initial);
    const change = { type: "deleteExpense", id: initial.expenses[0].id, version: 1 } as const;
    const updated = applyChange(initial, change, 0);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(updated)));
    await act(async () => { await current().mutate(change); });
    await render({ ...initial });
    expect(current().ledger).toEqual(updated);
  });
  it("reports corrupt stored data without overwriting it", async () => {
    const saved = demoLedger();
    saved.expenses[0].categoryId = "99999999-9999-4999-8999-999999999999";
    const encoded = JSON.stringify(saved);
    localStorage.setItem("pocketledger.synthetic-demo.v1", encoded);
    await render(demoLedger(), "demo");
    expect(current().error).toContain("Demo storage could not be read");
    expect(localStorage.getItem("pocketledger.synthetic-demo.v1")).toBe(encoded);
  });
  it("does not restore cleared cloud data after a session expires", async () => {
    const initial = demoLedger();
    await render(initial);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Session expired" }, { status: 401 })));
    await act(async () => { await current().mutate({ type: "deleteExpense", id: initial.expenses[0].id, version: 1 }); });
    await render({ ...initial });
    expect(current().ledger.expenses).toEqual([]);
    expect(current().ledger.profile.name).toBe("");
  });
});
