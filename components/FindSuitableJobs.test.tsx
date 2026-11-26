import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FindSuitableJobs from "./FindSuitableJobs";

const push = vi.fn();
let isDesktop = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => isDesktop }));
vi.mock("react-transition-progress", () => ({ useProgress: () => vi.fn() }));
vi.mock("@/lib/posthog/client", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("swr", () => ({
  default: () => ({
    data: [
      { id: "a1", title: "Backend Engineer" },
      { id: "b2", title: "Product Designer" },
    ],
  }),
}));

beforeAll(() => {
  // cmdk needs both, and jsdom has neither.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  isDesktop = true;
});

describe("FindSuitableJobs on the profiles page", () => {
  it.each([
    ["a popover on desktop", true],
    ["a drawer on a phone", false],
  ])("searches job posts by title in %s and starts the search", async (_name, desktop) => {
    isDesktop = desktop;
    render(<FindSuitableJobs user={null} currentPage="profiles" companyId="c1" />);

    fireEvent.click(screen.getByRole("button", { name: /AI Smart Search/ }));
    expect(!!document.querySelector("[data-vaul-drawer]")).toBe(!desktop);

    fireEvent.change(screen.getByPlaceholderText("Search job posts..."), { target: { value: "design" } });
    expect(screen.queryByText("Backend Engineer")).toBeNull();
    fireEvent.click(screen.getByText("Product Designer"));

    expect(push).toHaveBeenCalledWith("/company/profiles?sortBy=relevance&job_post=b2", { scroll: false });
  });
});
