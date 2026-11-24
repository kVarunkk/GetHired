import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("@/lib/posthog/client", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/app/actions/job-alerts/create-job-alert", () => ({
  createJobAlertAction: vi.fn(),
}));
vi.mock("@/app/actions/job-alerts/update-job-alert", () => ({
  updateJobAlertAction: vi.fn(),
}));

import posthog from "@/lib/posthog/client";
import { createJobAlertAction } from "@/app/actions/job-alerts/create-job-alert";
import { updateJobAlertAction } from "@/app/actions/job-alerts/update-job-alert";
import { ALERT_BANNER_STORAGE_KEY } from "./banner-state";
import JobAlertBanner, { type JobAlertBannerProps } from "./JobAlertBanner";
import { resetSharedAlertState } from "./useJobAlertControls";

const PROPS: JobAlertBannerProps = {
  search: "location=pune&jobTitleKeywords=frontend",
  filtersKey: "key-1",
  name: "Frontend jobs in Pune",
  isLoggedIn: true,
  isCompany: false,
  tab: null,
  sortBy: null,
  alert: { state: "none", id: null, frequency: "weekly" },
  activeCount: 0,
};

const created = {
  ok: true as const,
  resumed: false,
  alert: { id: "a1", frequency: "weekly" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSharedAlertState();
  window.localStorage.clear();
});

describe("JobAlertBanner (JAT-041, JA-TST-003)", () => {
  it("offers an alert and creates it, then confirms in place", async () => {
    vi.mocked(createJobAlertAction).mockResolvedValue(created as never);
    render(<JobAlertBanner {...PROPS} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Create alert" }),
    );

    expect(createJobAlertAction).toHaveBeenCalledWith({
      search: PROPS.search,
      frequency: "weekly",
      source: "feed_banner",
    });
    expect(
      await screen.findByText("Alert on for Frontend jobs in Pune"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage alerts" })).toHaveAttribute(
      "href",
      "/settings#job-alerts",
    );
  });

  it("shows the failure copy inline", async () => {
    vi.mocked(createJobAlertAction).mockResolvedValue({
      ok: false,
      reason: "failed",
      error: "Nope.",
    });
    render(<JobAlertBanner {...PROPS} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Create alert" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
  });

  it("resumes a paused alert", async () => {
    vi.mocked(updateJobAlertAction).mockResolvedValue({ ok: true } as never);
    render(
      <JobAlertBanner
        {...PROPS}
        alert={{ state: "paused", id: "a1", frequency: "daily" }}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Resume alert" }),
    );
    expect(updateJobAlertAction).toHaveBeenCalledWith({
      id: "a1",
      on: true,
      frequency: "weekly",
    });
    expect(createJobAlertAction).not.toHaveBeenCalled();
  });

  it("at the cap says so and has no create button", async () => {
    render(<JobAlertBanner {...PROPS} activeCount={5} />);
    expect(
      await screen.findByText(/You have 5 active alerts/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create alert" })).toBeNull();
  });

  it("renders nothing for an active alert, a company, a saved tab, AI search or a non-alertable search", async () => {
    const cases: Partial<JobAlertBannerProps>[] = [
      { alert: { state: "active", id: "a1", frequency: "weekly" } },
      { isCompany: true },
      { tab: "saved" },
      { sortBy: "relevance" },
      { filtersKey: null },
    ];
    for (const c of cases) {
      const { container, unmount } = render(
        <JobAlertBanner {...PROPS} {...c} />,
      );
      await waitFor(() => expect(container).toBeEmptyDOMElement());
      unmount();
    }
  });

  it("dismissal hides it, records it and survives a remount", async () => {
    const { unmount } = render(<JobAlertBanner {...PROPS} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Dismiss" }),
    );
    expect(screen.queryByRole("region")).toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem(ALERT_BANNER_STORAGE_KEY)!).keys,
    ).toEqual(["key-1"]);
    expect(posthog.capture).toHaveBeenCalledWith(
      "job_alert_banner_dismissed",
      expect.anything(),
    );
    unmount();
    const again = render(<JobAlertBanner {...PROPS} />);
    await waitFor(() => expect(again.container).toBeEmptyDOMElement());
  });

  it("reads corrupt storage as nothing dismissed", async () => {
    window.localStorage.setItem(ALERT_BANNER_STORAGE_KEY, "{broken");
    render(<JobAlertBanner {...PROPS} />);
    expect(
      await screen.findByRole("button", { name: "Create alert" }),
    ).toBeInTheDocument();
  });

  it("fires shown once per key", async () => {
    const { rerender } = render(<JobAlertBanner {...PROPS} />);
    await screen.findByRole("button", { name: "Create alert" });
    rerender(<JobAlertBanner {...PROPS} />);
    expect(
      vi
        .mocked(posthog.capture)
        .mock.calls.filter(([e]) => e === "job_alert_banner_shown"),
    ).toHaveLength(1);
  });

  it("logged out links to sign-up with createAlert and fires signup_started", async () => {
    render(<JobAlertBanner {...PROPS} isLoggedIn={false} />);
    const link = await screen.findByRole("link", { name: "Create alert" });
    const href = link.getAttribute("href")!;
    expect(href.startsWith("/auth/sign-up?returnTo=")).toBe(true);
    expect(decodeURIComponent(href)).toContain("createAlert=weekly");
    await userEvent.click(link);
    expect(posthog.capture).toHaveBeenCalledWith(
      "job_alert_signup_started",
      expect.anything(),
    );
  });

  it("the empty state uses its own copy and source, even after a dismissal", async () => {
    vi.mocked(createJobAlertAction).mockResolvedValue(created as never);
    window.localStorage.setItem(
      ALERT_BANNER_STORAGE_KEY,
      JSON.stringify({ keys: ["key-1"], times: [], quietUntil: null }),
    );
    render(<JobAlertBanner {...PROPS} variant="empty_state" />);
    expect(
      screen.getByText(
        "No Frontend jobs in Pune right now. We'll email you when one is posted.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Create alert" }));
    expect(createJobAlertAction).toHaveBeenCalledWith(
      expect.objectContaining({ source: "empty_state" }),
    );
  });

  it("offers the alert again when the filters change after one was created", async () => {
    vi.mocked(createJobAlertAction).mockResolvedValue(created as never);
    const { rerender } = render(<JobAlertBanner {...PROPS} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Create alert" }),
    );
    expect(
      await screen.findByText("Alert on for Frontend jobs in Pune"),
    ).toBeInTheDocument();

    rerender(
      <JobAlertBanner
        {...PROPS}
        search="jobTitleKeywords=frontend"
        filtersKey="key-2"
        name="Frontend jobs"
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Create alert" }),
    ).toBeInTheDocument();
  });
});
