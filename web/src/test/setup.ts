import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock "server-only" globally — it throws in non-RSC environments (vitest runs in Node.js)
vi.mock("server-only", () => ({}));

// Mock client env globally — the real module throws at load time if env vars are missing
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    NEXT_PUBLIC_APP_URL: "",
    NEXT_PUBLIC_DEFAULT_LOCALE: "sk",
    NEXT_PUBLIC_ENABLE_ERUDA: false,
  },
}));
