import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/utils/get-base-url", () => ({ getBaseUrl: async () => "http://localhost" }));
vi.mock("@/components/FilterComponent", () => ({ default: () => null }));
vi.mock("@/components/ClientTabs", () => ({ ClientTabs: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/JobsComponent", () => ({ default: () => null }));
vi.mock("@/components/agent/AskAgentOnApplicantPages", () => ({ AskAgentAboutJobs: () => null }));

import JobsPage from "./page";

const page = (searchParams: Record<string, string>) => JobsPage({ searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  redirect.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ data: [], totalCount: 0 }) })),
  );
});

describe("/jobs is Discover (AT-REQ-012, AT-REQ-025)", () => {
  it("sends the old Applied tab link to My Jobs Applications, dropping other params", async () => {
    await expect(page({ tab: "applied", applicationStatus: "selected", sortBy: "created_at" })).rejects.toThrow(
      "NEXT_REDIRECT:/my-jobs",
    );
    expect(redirect).toHaveBeenCalledWith("/my-jobs");
  });

  it("sends the old Saved tab link to My Jobs Saved", async () => {
    await expect(page({ tab: "saved", sortBy: "created_at" })).rejects.toThrow("NEXT_REDIRECT:/my-jobs?tab=saved");
  });

  it("shows the feed, titled Discover, with no tab redirect", async () => {
    const element = (await page({})) as { props: { children: unknown } };
    expect(redirect).not.toHaveBeenCalled();
    expect(JSON.stringify(element, (_, value) => (typeof value === "function" ? "fn" : value))).toContain("Discover");
  });
});
