import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { afterCallbacks } from "./utils/after";

// Server actions call revalidatePath/revalidateTag, which need a Next request context.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

// `server-only` throws outside a React Server environment. The agent route
// imports every role, so even applicant tests load server-only billing code.
vi.mock("server-only", () => ({}));

// `after()` throws outside a Next request scope. Collect callbacks instead so
// tests can assert on scheduled background work via flushAfter().
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: (() => unknown) | Promise<unknown>) => {
      afterCallbacks.push(task);
    },
  };
});

afterEach(async () => {
  afterCallbacks.length = 0;
  // RTL only auto-cleans with `globals: true`; unmount rendered trees in jsdom tests.
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
