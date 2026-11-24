import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const replace = vi.fn();
let query = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
  usePathname: () => "/jobs",
  useRouter: () => ({ replace }),
}));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("@/lib/posthog/client", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/app/actions/job-alerts/create-job-alert", () => ({ createJobAlertAction: vi.fn() }));
vi.mock("@/app/actions/job-alerts/update-job-alert", () => ({ updateJobAlertAction: vi.fn() }));

import { createJobAlertAction } from "@/app/actions/job-alerts/create-job-alert";
import JobAlertSlot, { type JobAlertFeedProps } from "./JobAlertSlot";

const FEED: JobAlertFeedProps = {
  filtersKey: "key-1",
  name: "Frontend jobs in Pune",
  isLoggedIn: true,
  isCompany: false,
  alert: { state: "none", id: null, frequency: "weekly" },
  activeCount: 0,
};

const setQuery = (q: string) => {
  query = q;
  window.history.replaceState(null, "", `/jobs?${q}`);
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(createJobAlertAction).mockResolvedValue({
    ok: true,
    resumed: false,
    alert: { id: "a1", frequency: "daily" },
  } as never);
  setQuery("location=pune");
});

describe("JobAlertSlot (JAT-043, JAT-044)", () => {
  it("sends the filters without tab, createAlert and ref params", async () => {
    setQuery("location=pune&tab=all&ref=job_alert&aid=x");
    const { findByRole } = render(<JobAlertSlot placement="inline" {...FEED} />);
    (await findByRole("button", { name: "Create alert" })).click();
    await waitFor(() =>
      expect(createJobAlertAction).toHaveBeenCalledWith(expect.objectContaining({ search: "location=pune" })),
    );
  });

  it("consumes createAlert once for a signed-in applicant, then drops the param", async () => {
    setQuery("location=pune&createAlert=daily");
    const { rerender } = render(<JobAlertSlot placement="inline" {...FEED} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/jobs?location=pune"));
    expect(createJobAlertAction).toHaveBeenCalledTimes(1);
    expect(createJobAlertAction).toHaveBeenCalledWith({
      search: "location=pune",
      frequency: "daily",
      source: "feed_banner",
    });
    expect(await screen.findByText("Alert on for Frontend jobs in Pune")).toBeInTheDocument();
    rerender(<JobAlertSlot placement="inline" {...FEED} />);
    expect(createJobAlertAction).toHaveBeenCalledTimes(1);
  });

  it("drops the param silently for a company user", async () => {
    setQuery("location=pune&createAlert=weekly");
    render(<JobAlertSlot placement="inline" {...FEED} isCompany />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/jobs?location=pune"));
    expect(createJobAlertAction).not.toHaveBeenCalled();
  });

  it("drops the param for a non-alertable search and for a signed-out viewer", async () => {
    setQuery("createAlert=weekly");
    render(<JobAlertSlot placement="inline" {...FEED} filtersKey={null} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/jobs"));
    render(<JobAlertSlot placement="inline" {...FEED} isLoggedIn={false} />);
    expect(createJobAlertAction).not.toHaveBeenCalled();
  });

  it("shows the quiet line above the list for an active alert", () => {
    render(
      <JobAlertSlot placement="above" {...FEED} alert={{ state: "active", id: "a1", frequency: "weekly" }} />,
    );
    expect(screen.getByText(/You get alerts for this search/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/settings#job-alerts");
  });

  it("shows no line without an alert, and on an AI search", () => {
    expect(render(<JobAlertSlot placement="above" {...FEED} />).container).toBeEmptyDOMElement();
    setQuery("sortBy=relevance");
    const active = { state: "active", id: "a1", frequency: "weekly" } as const;
    expect(render(<JobAlertSlot placement="above" {...FEED} alert={active} />).container).toBeEmptyDOMElement();
  });

  it("the empty state offers the alert with its own copy", async () => {
    render(<JobAlertSlot placement="empty" {...FEED} />);
    expect(
      screen.getByText("No Frontend jobs in Pune right now. We'll email you when one is posted."),
    ).toBeInTheDocument();
  });
});
