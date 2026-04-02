import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock "server-only" globally — it throws in non-RSC environments (vitest runs in Node.js)
vi.mock("server-only", () => ({}));
