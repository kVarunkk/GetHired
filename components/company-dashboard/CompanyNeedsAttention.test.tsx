import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { markScreeningReviewedAction } from "@/app/actions/interviews/mark-screening-reviewed";
import { remindInterviewersAction } from "@/app/actions/interviews/remind-interviewers";
import { renewSchedulingLinkAction } from "@/app/actions/interviews/send-scheduling-link";
import type { CompanyAttentionItem } from "@/helpers/company-dashboard/summary";
import CompanyNeedsAttention from "./CompanyNeedsAttention";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/app/actions/interviews/mark-screening-reviewed", () => ({ markScreeningReviewedAction: vi.fn() }));
vi.mock("@/app/actions/interviews/remind-interviewers", () => ({ remindInterviewersAction: vi.fn() }));
vi.mock("@/app/actions/interviews/send-scheduling-link", () => ({ renewSchedulingLinkAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/move-applications", () => ({ moveApplicationsAction: vi.fn() }));
vi.mock("@/components/pipeline/MoveDialog", () => ({ default: () => null }));

const item = (over: Partial<CompanyAttentionItem> = {}): CompanyAttentionItem => ({
  key: "interview:iv-1",
  kind: "feedback_overdue",
  title: "Priya",
  detail: "Tech screen · 2 scorecards overdue",
  href: "/company/applications/app-1/interviews",
  sortKey: "a",
  mine: false,
  action: { type: "remind", label: "Remind panel", interviewId: "iv-1" },
  move: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("CompanyNeedsAttention (CD-REQ-019)", () => {
  it("removes the row once the panel is reminded", async () => {
    vi.mocked(remindInterviewersAction).mockResolvedValue({
      ok: true,
      applicationId: "app-1",
      reminded: [{ userId: "u", name: "Ada" }],
      skipped: [],
    });
    render(<CompanyNeedsAttention items={[item()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remind panel" }));

    await waitFor(() => expect(screen.queryByText("Priya")).not.toBeInTheDocument());
    expect(screen.getByText("All caught up")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Reminded Ada.");
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the row when the action fails", async () => {
    vi.mocked(renewSchedulingLinkAction).mockResolvedValue({ ok: false, error: "No link." } as Awaited<
      ReturnType<typeof renewSchedulingLinkAction>
    >);
    render(
      <CompanyNeedsAttention
        items={[item({ action: { type: "resend", label: "Resend link", interviewId: "iv-1", templateId: "t" } })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resend link" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No link."));
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(renewSchedulingLinkAction).toHaveBeenCalledWith({ interviewId: "iv-1", email: { templateId: "t" } });
  });

  it("removes an AI interview row once it is marked reviewed", async () => {
    vi.mocked(markScreeningReviewedAction).mockResolvedValue({ ok: true });
    render(
      <CompanyNeedsAttention
        items={[
          item({
            kind: "screening_to_review",
            action: { type: "link", label: "Review", href: "/x" },
            reviewInterviewId: "ai-1",
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));

    await waitFor(() => expect(screen.queryByText("Priya")).not.toBeInTheDocument());
    expect(markScreeningReviewedAction).toHaveBeenCalledWith({ id: "ai-1" });
  });

  it("shows 8 rows and a View all link for what's past them", () => {
    render(
      <CompanyNeedsAttention
        items={Array.from({ length: 10 }, (_, i) => item({ key: `k${i}`, title: `Person ${i}` }))}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByRole("link", { name: "Overdue scorecards" })).toHaveAttribute("href", "/company/my-interviews");
  });
});
