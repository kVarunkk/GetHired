import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/ui/responsive-select", () => import("@/test/utils/select-mock"));
vi.mock("@/lib/posthog/client", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/app/actions/job-alerts/create-job-alert", () => ({
  createJobAlertAction: vi.fn(),
}));
vi.mock("@/app/actions/job-alerts/update-job-alert", () => ({
  updateJobAlertAction: vi.fn(),
}));

import { createJobAlertAction } from "@/app/actions/job-alerts/create-job-alert";
import { updateJobAlertAction } from "@/app/actions/job-alerts/update-job-alert";
import JobAlertButton, { type JobAlertButtonProps } from "./JobAlertButton";
import JobAlertBanner from "./JobAlertBanner";
import { resetSharedAlertState } from "./useJobAlertControls";

const PROPS: JobAlertButtonProps = {
  search: "sortBy=relevance&location=pune",
  filtersKey: "key-1",
  name: "Jobs in Pune",
  isLoggedIn: true,
  isCompany: false,
  alert: { state: "none", id: null, frequency: "weekly" },
  activeCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSharedAlertState();
});

describe("JobAlertButton (JAT-042)", () => {
  it("is labelled Alert, and creates for an AI search too", async () => {
    vi.mocked(createJobAlertAction).mockResolvedValue({
      ok: true,
      resumed: false,
      alert: { id: "a1", frequency: "weekly" },
    } as never);
    render(<JobAlertButton {...PROPS} />);
    await userEvent.click(screen.getByRole("button", { name: /Alert/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Create alert" }),
    );
    expect(createJobAlertAction).toHaveBeenCalledWith(
      expect.objectContaining({ search: PROPS.search }),
    );
    expect(
      await screen.findByRole("button", { name: /Alert on/ }),
    ).toBeInTheDocument();
  });

  it("is labelled Alert on for an active alert and pauses it", async () => {
    vi.mocked(updateJobAlertAction).mockResolvedValue({ ok: true } as never);
    render(
      <JobAlertButton
        {...PROPS}
        alert={{ state: "active", id: "a1", frequency: "daily" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Alert on/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(updateJobAlertAction).toHaveBeenCalledWith({ id: "a1", on: false });
  });

  it("shows no create button at the cap", async () => {
    render(<JobAlertButton {...PROPS} activeCount={5} />);
    await userEvent.click(screen.getByRole("button", { name: /Alert/ }));
    expect(
      await screen.findByText(/You have 5 active alerts/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create alert" })).toBeNull();
  });

  it("is hidden for companies and non-alertable searches", () => {
    expect(
      render(<JobAlertButton {...PROPS} isCompany />).container,
    ).toBeEmptyDOMElement();
    expect(
      render(<JobAlertButton {...PROPS} filtersKey={null} />).container,
    ).toBeEmptyDOMElement();
  });

  it("follows the server when the filters change, without a reload", () => {
    const { rerender } = render(
      <JobAlertButton
        {...PROPS}
        alert={{ state: "active", id: "a1", frequency: "weekly" }}
      />,
    );
    expect(screen.getByRole("button", { name: /Alert on/ })).toBeInTheDocument();

    rerender(
      <JobAlertButton
        {...PROPS}
        search="sortBy=relevance&location=pune&jobTitleKeywords=frontend"
        filtersKey="key-2"
        alert={{ state: "none", id: null, frequency: "weekly" }}
      />,
    );
    expect(screen.queryByRole("button", { name: /Alert on/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Alert/ })).toBeInTheDocument();
  });

  it("hides the banner for the same search once the button creates the alert", async () => {
    window.localStorage.clear();
    vi.mocked(createJobAlertAction).mockResolvedValue({
      ok: true,
      resumed: false,
      alert: { id: "a1", frequency: "weekly" },
    } as never);
    render(
      <>
        <JobAlertButton {...PROPS} />
        <JobAlertBanner {...PROPS} tab={null} sortBy={null} />
      </>,
    );
    expect(
      await screen.findAllByRole("button", { name: "Create alert" }),
    ).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /^Alert$/ }));
    await userEvent.click(
      (await screen.findAllByRole("button", { name: "Create alert" }))[1],
    );
    expect(
      await screen.findByRole("button", { name: /Alert on/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create alert" })).toBeNull();
  });
});
