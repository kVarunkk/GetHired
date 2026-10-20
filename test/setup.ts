import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
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

// jsdom has no matchMedia. Default to a desktop viewport, so ResponsiveDialog
// renders its Dialog; tests for the phone layout set their own.
function desktopMatchMedia(query: string) {
  return {
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

beforeEach(() => {
  if (typeof window !== "undefined") window.matchMedia = desktopMatchMedia;
});

afterEach(async () => {
  afterCallbacks.length = 0;
  // RTL only auto-cleans with `globals: true`; unmount rendered trees in jsdom tests.
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
