import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { previewAgentJobAlertAction } from "@/app/actions/job-alerts/preview-agent-job-alert";
import { JobAlertApprovalDetails } from "./JobAlertApprovalCard";

vi.mock("@/app/actions/job-alerts/preview-agent-job-alert", () => ({
  previewAgentJobAlertAction: vi.fn(),
}));

const INPUT = { filters: { keywords: ["frontend"] }, frequency: "weekly" };

describe("JobAlertApprovalDetails", () => {
  it("shows a new alert's name, frequency and matching jobs", async () => {
    vi.mocked(previewAgentJobAlertAction).mockResolvedValue({
      ok: true,
      action: "create",
      name: "Frontend jobs",
      frequency: "weekly",
      existing: null,
      sample: { total: 12, jobs: [{ id: "j1", title: "UI Developer", company: "Acme" }] },
    });

    render(<JobAlertApprovalDetails tool="createJobAlert" input={INPUT} />);

    expect(await screen.findByText("Frontend jobs")).toBeInTheDocument();
    expect(screen.getByText("Weekly, on Mondays")).toBeInTheDocument();
    expect(screen.getByText("12 jobs match now, such as")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "UI Developer at Acme" });
    expect(link).toHaveAttribute("href", "/jobs/j1");
    // The chat stays open while the user looks at a job.
    expect(link).toHaveAttribute("target", "_blank");
    expect(previewAgentJobAlertAction).toHaveBeenCalledWith("createJobAlert", INPUT);
  });

  it("shows what a change does", async () => {
    vi.mocked(previewAgentJobAlertAction).mockResolvedValue({
      ok: true,
      action: "update",
      name: "Frontend jobs",
      changes: [{ label: "Status", before: "On", after: "Paused" }],
    });

    render(<JobAlertApprovalDetails tool="updateJobAlert" input={{ alertId: "a1", on: false }} />);

    expect(await screen.findByText("On → Paused")).toBeInTheDocument();
  });

  it("says when the call won't go through, and why", async () => {
    vi.mocked(previewAgentJobAlertAction).mockResolvedValue({ ok: false, error: "Alert not found." });

    render(<JobAlertApprovalDetails tool="updateJobAlert" input={{ alertId: "a1", on: false }} />);

    expect(await screen.findByText(/won't go through: Alert not found\./)).toBeInTheDocument();
  });
});
