import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/ui/responsive-select", () => import("@/test/utils/select-mock"));
vi.mock("@/app/actions/job-alerts/update-job-alert", () => ({ updateJobAlertAction: vi.fn() }));
vi.mock("@/app/actions/job-alerts/list-job-alerts", () => ({ listJobAlertsAction: vi.fn().mockResolvedValue(null) }));
vi.mock("@/app/actions/job-alerts/delete-job-alert", () => ({ deleteJobAlertAction: vi.fn() }));

import { updateJobAlertAction } from "@/app/actions/job-alerts/update-job-alert";
import { deleteJobAlertAction } from "@/app/actions/job-alerts/delete-job-alert";
import type { JobAlert } from "@/helpers/job-alerts/alerts";
import JobAlertsList from "./JobAlertsList";

const ALERT: JobAlert = {
  id: "a1",
  name: "Frontend jobs in Pune",
  url: "/jobs?jobTitleKeywords=frontend&location=pune",
  filters: { jobTitleKeywords: ["frontend"], location: ["pune"], jobType: ["Fulltime"] },
  frequency: "weekly",
  on: true,
  createdAt: "2026-11-01T00:00:00Z",
  lastSentAt: null,
  source: "feed_banner",
};

const ok = (patch: Partial<JobAlert>) => ({ ok: true, alert: { ...ALERT, ...patch }, changed: [] }) as never;

beforeEach(() => vi.clearAllMocks());

describe("JobAlertsList (JAT-050)", () => {
  it("shows the empty state linking to /jobs", () => {
    render(<JobAlertsList initialAlerts={[]} />);
    expect(screen.getByRole("link", { name: "Search jobs" })).toHaveAttribute("href", "/jobs");
  });

  it("shows the filter summary and a View jobs link", () => {
    render(<JobAlertsList initialAlerts={[ALERT]} />);
    expect(screen.getByText("Fulltime")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View jobs" })).toHaveAttribute("href", ALERT.url);
  });

  it("pauses through the switch", async () => {
    vi.mocked(updateJobAlertAction).mockResolvedValue(ok({ on: false }));
    render(<JobAlertsList initialAlerts={[ALERT]} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(updateJobAlertAction).toHaveBeenCalledWith({ id: "a1", on: false });
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked());
  });

  it("reverts the switch and shows the cap copy when turning one on fails", async () => {
    vi.mocked(updateJobAlertAction).mockResolvedValue({
      ok: false,
      reason: "cap",
      error: "You have 5 active alerts. Pause one to add this search.",
    });
    render(<JobAlertsList initialAlerts={[{ ...ALERT, on: false }]} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have 5 active alerts");
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("changes the frequency", async () => {
    vi.mocked(updateJobAlertAction).mockResolvedValue(ok({ frequency: "daily" }));
    render(<JobAlertsList initialAlerts={[ALERT]} />);
    await userEvent.selectOptions(screen.getByLabelText("Frequency"), "daily");
    expect(updateJobAlertAction).toHaveBeenCalledWith({ id: "a1", frequency: "daily" });
  });

  it("renames on blur, and not when unchanged", async () => {
    vi.mocked(updateJobAlertAction).mockResolvedValue(ok({ name: "Mine" }));
    render(<JobAlertsList initialAlerts={[ALERT]} />);
    const input = screen.getByLabelText("Alert name");
    await userEvent.click(input);
    await userEvent.tab();
    expect(updateJobAlertAction).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "Mine");
    await userEvent.tab();
    expect(updateJobAlertAction).toHaveBeenCalledWith({ id: "a1", name: "Mine" });
  });

  it("deletes only after confirming", async () => {
    vi.mocked(deleteJobAlertAction).mockResolvedValue({ ok: true });
    render(<JobAlertsList initialAlerts={[ALERT]} />);
    await userEvent.click(screen.getByRole("button", { name: /Delete Frontend/ }));
    expect(deleteJobAlertAction).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Delete alert" }));
    expect(deleteJobAlertAction).toHaveBeenCalledWith({ id: "a1" });
    await waitFor(() => expect(screen.queryByLabelText("Alert name")).toBeNull());
    expect(screen.getByText(/You have no job alerts/)).toBeInTheDocument();
  });
});
