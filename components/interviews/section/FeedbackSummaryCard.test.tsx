import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import FeedbackSummaryCard from "./FeedbackSummaryCard";
import type { FeedbackSummaryView } from "@/helpers/interviews/feedback-summary";

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/actions/interviews/summarize-feedback", () => ({ summarizeFeedbackAction: vi.fn() }));
const handleEntitlement = vi.fn(async () => false);
vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: handleEntitlement, show: vi.fn(), dialog: <div data-testid="upgrade" /> }),
}));

import toast from "react-hot-toast";
import { summarizeFeedbackAction } from "@/app/actions/interviews/summarize-feedback";

const APP = "e1700000-0000-4000-8000-000000000001";
const SUMMARY = {
  agreements: [
    {
      text: "Strong on API design.",
      quotes: [{ scorecardId: "s1", author: "Rita", interview: "Systems", quote: "Good pagination answer." }],
    },
  ],
  disagreements: [{ competency: "Communication", text: "One found them clear, one didn't.", quotes: [] }],
  concerns: [],
};
const view = (over: Partial<FeedbackSummaryView> = {}): FeedbackSummaryView => ({
  submitted: 2,
  min: 2,
  summary: null,
  createdAt: null,
  stale: false,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("FeedbackSummaryCard (IVT-081)", () => {
  it("waits for enough scorecards", () => {
    render(<FeedbackSummaryCard applicationId={APP} initial={view({ submitted: 1 })} />);
    expect(screen.getByText("Available once 2 scorecards are submitted (1 so far).")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers a summary with its cost, and shows it once made", async () => {
    vi.mocked(summarizeFeedbackAction).mockResolvedValue({
      ok: true,
      view: view({ summary: SUMMARY, createdAt: "2026-11-14T10:00:00Z" }),
    });
    render(<FeedbackSummaryCard applicationId={APP} initial={view()} />);
    expect(screen.getByText(/Uses 1 agent message\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Summarize feedback/ }));

    const card = screen.getByRole("region", { name: "Feedback summary" });
    expect(await within(card).findByText("Strong on API design.")).toBeInTheDocument();
    expect(summarizeFeedbackAction).toHaveBeenCalledWith({ applicationId: APP });
    expect(within(card).getByText(/Good pagination answer\./)).toBeInTheDocument();
    expect(within(card).getByText(/Rita, Systems/)).toBeInTheDocument();
    expect(within(card).getByText("Communication:")).toBeInTheDocument();
    expect(within(card).getByText("None raised.")).toBeInTheDocument();
    expect(within(card).getByText(/doesn't recommend a decision/)).toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("says when it's out of date and offers to regenerate", () => {
    render(<FeedbackSummaryCard applicationId={APP} initial={view({ submitted: 3, summary: SUMMARY, stale: true })} />);
    expect(screen.getByText("Out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Regenerate/ })).toBeInTheDocument();
    expect(screen.getByText("Strong on API design.")).toBeInTheDocument();
  });

  it("shows the action's error", async () => {
    vi.mocked(summarizeFeedbackAction).mockResolvedValue({ ok: false, error: "The scorecards changed." });
    render(<FeedbackSummaryCard applicationId={APP} initial={view()} />);
    fireEvent.click(screen.getByRole("button", { name: /Summarize feedback/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The scorecards changed."));
  });

  it("hands an entitlement refusal to the upgrade dialog", async () => {
    const refused = { error: { code: "entitlement", key: "agent_messages" } };
    vi.mocked(summarizeFeedbackAction).mockResolvedValue(refused as never);
    handleEntitlement.mockResolvedValueOnce(true);
    render(<FeedbackSummaryCard applicationId={APP} initial={view()} />);
    fireEvent.click(screen.getByRole("button", { name: /Summarize feedback/ }));
    await waitFor(() => expect(handleEntitlement).toHaveBeenCalledWith(refused));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
