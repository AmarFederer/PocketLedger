import { expect, it } from "vitest";
import { appMode } from "./config";

it("fails closed without configuration and rejects a production demo", () => {
  expect(appMode({})).toBe("unconfigured");
  expect(appMode({ NODE_ENV: "production", POCKETLEDGER_DEMO: "true" })).toBe("unconfigured");
  expect(appMode({ NODE_ENV: "development", POCKETLEDGER_DEMO: "true" })).toBe("demo");
  expect(appMode({ NODE_ENV: "production", POCKETLEDGER_DEMO: "true", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test" })).toBe("cloud");
});