import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { openMySchedulingLinkAction } from "@/app/actions/interviews/open-my-scheduling-link";
import type { MyScheduledInterview } from "@/helpers/interviews/my-scheduled-interviews";
import MyScheduledInterviews from "./MyScheduledInterviews";

vi.mock("@/app/actions/interviews/open-my-scheduling-link", () => ({ openMySchedulingLinkAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));

const interview = (overrides: Partial<MyScheduledInterview> = {}): MyScheduledInterview => ({
  id: "f1000000-0000-4000-8000-000000000001",
  application_id: "e0000000-0000-4000-8000-000000000001",
  job_title: "Backend Engineer",
  company_name: "Acme",
  interview_name: "Intro call",
  duration_minutes: 30,
  status: "scheduled",
  starts_at: "2026-11-17T10:00:00.000Z",
  ends_at: "2026-11-17T10:30:00.000Z",
  meeting_url: "https://meet.google.com/abc-defg-hij",
  can_reschedule: true,
  ...overrides,
});

const assign = vi.fn();
beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MyScheduledInterviews (IVT-064)", () => {
  it("renders nothing without interviews", () => {
    const { container } = render(<MyScheduledInterviews interviews={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the interview, job, company, time and the meeting link", () => {
    render(<MyScheduledInterviews interviews={[interview()]} />);
    expect(screen.getByText("Intro call")).toBeInTheDocument();
    expect(screen.getByText("Backend Engineer · Acme")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
    expect(screen.getByRole("button", { name: "Reschedule" })).toBeInTheDocument();
  });

  it("asks to pick a time for a link, and opens it", async () => {
    vi.mocked(openMySchedulingLinkAction).mockResolvedValue({ ok: true, path: "/schedule/abc" });
    render(<MyScheduledInterviews interviews={[interview({ status: "awaiting_candidate", starts_at: null, ends_at: null, meeting_url: null })]} />);
    expect(screen.getByText("Pick a time for this 30-minute interview.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Join" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick a time" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/schedule/abc"));
    expect(openMySchedulingLinkAction).toHaveBeenCalledWith({ interviewId: "f1000000-0000-4000-8000-000000000001" });
  });

  it("offers no reschedule when it can't be moved, and says why when opening fails", async () => {
    render(<MyScheduledInterviews interviews={[interview({ can_reschedule: false })]} />);
    expect(screen.queryByRole("button", { name: "Reschedule" })).not.toBeInTheDocument();

    vi.mocked(openMySchedulingLinkAction).mockResolvedValue({ ok: false, error: "Can't be changed." });
    render(<MyScheduledInterviews interviews={[interview({ id: "other" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Can't be changed."));
    expect(assign).not.toHaveBeenCalled();
  });
});
