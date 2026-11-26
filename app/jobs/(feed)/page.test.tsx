import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const session = vi.hoisted(() => ({
  user: null as { id: string; app_metadata: Record<string, unknown> } | null,
  client: null as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    session.client = { auth: { getUser: async () => ({ data: { user: session.user } }) } };
    return session.client;
  },
}));
vi.mock("@/helpers/jobs/public-jobs-feed", () => ({ loadPublicJobsFeed: vi.fn() }));
vi.mock("@/helpers/jobs/search-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/jobs/search-jobs")>()),
  searchJobs: vi.fn(),
}));
vi.mock("@/helpers/job-alerts/page-state", () => ({ loadJobAlertFeedState: async () => null }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));
vi.mock("@/components/FilterComponent", () => ({ default: () => null }));
vi.mock("@/components/ClientTabs", () => ({ ClientTabs: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/JobsComponent", () => ({ default: () => null }));
vi.mock("@/components/agent/AskAgentOnApplicantPages", () => ({ AskAgentAboutJobs: () => null }));

import { loadPublicJobsFeed } from "@/helpers/jobs/public-jobs-feed";
import { searchJobs } from "@/helpers/jobs/search-jobs";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import JobsPage from "./page";

const page = (searchParams: Record<string, string>) => JobsPage({ searchParams: Promise.resolve(searchParams) });
const render = async (searchParams: Record<string, string>) =>
  JSON.stringify(await page(searchParams), (_, value) => (typeof value === "function" ? "fn" : value));

const EMPTY = { ok: true as const, data: [], totalCount: 0, nextCursor: null };
const applicant = { id: "user-1", app_metadata: { type: "applicant", onboarding_complete: true } };

beforeEach(() => {
  vi.clearAllMocks();
  session.user = null;
  vi.mocked(loadPublicJobsFeed).mockResolvedValue(EMPTY);
  vi.mocked(searchJobs).mockResolvedValue(EMPTY);
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
    expect(await render({})).toContain("Discover");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("/jobs feed data", () => {
  it("reads other sorts from the shared feed with the cleaned filters, even when signed in", async () => {
    session.user = applicant;
    await page({ sortBy: "salary_min", location: "Remote", userId: "someone-else", junk: "1" });
    expect(loadPublicJobsFeed).toHaveBeenCalledWith("location=Remote&sortBy=salary_min", expect.anything());
    expect(searchJobs).not.toHaveBeenCalled();
  });

  it("searches by relevance as the request user, with their client and no cache", async () => {
    session.user = applicant;
    await page({ sortBy: "relevance", userId: "someone-else" });
    expect(loadPublicJobsFeed).not.toHaveBeenCalled();
    expect(searchJobs).toHaveBeenCalledWith(
      session.client,
      applicant,
      expect.objectContaining({ sortBy: "relevance", applicantUserId: null }),
      expect.anything(),
    );
  });

  it("shows an expected refusal without reporting it", async () => {
    vi.mocked(searchJobs).mockResolvedValue({ ok: false, status: 401, error: "User not found." });
    expect(await render({ sortBy: "relevance" })).toContain("User not found.");
    expect(eventCaptureServerException).not.toHaveBeenCalled();
  });

  it("shows and reports a failed search, with the stage it failed at", async () => {
    session.user = applicant;
    vi.mocked(searchJobs).mockImplementation(async (_client, _user, _params, trace) => {
      Object.assign(trace!, { stage: "build_jobs_query", distinctId: applicant.id });
      throw { message: "statement timeout", code: "57014" };
    });
    expect(await render({ sortBy: "relevance" })).toContain("statement timeout");
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: applicant.id,
        properties: expect.objectContaining({
          flow: "jobs_page",
          failure_stage: "build_jobs_query",
          error_code: "57014",
          filters: ["sortBy"],
        }),
      }),
    );
  });
});
