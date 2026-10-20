import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { previewAgentApplicationAction } from "@/app/actions/applications/preview-agent-application";
import { ApplicationApprovalDetails } from "./ApplicationApprovalCard";

vi.mock("@/app/actions/applications/preview-agent-application", () => ({
  previewAgentApplicationAction: vi.fn(),
}));

const INPUT = { jobId: "j1", answers: [{ key: "q1", value: "The mission" }] };

describe("ApplicationApprovalDetails", () => {
  it("shows the job, the resume and every answer under its label", async () => {
    vi.mocked(previewAgentApplicationAction).mockResolvedValue({
      ok: true,
      job: { title: "Engineer", company: "Acme" },
      resume: "Main",
      answers: [
        { key: "q1", label: "Why us?", text: "The mission" },
        { key: "q2", label: "Nickname?", text: null },
      ],
    });

    render(<ApplicationApprovalDetails input={INPUT} />);

    expect(await screen.findByText("Engineer at Acme")).toBeInTheDocument();
    expect(screen.getByText("Main")).toBeInTheDocument();
    expect(screen.getByText("Why us?")).toBeInTheDocument();
    expect(screen.getByText("The mission")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(previewAgentApplicationAction).toHaveBeenCalledWith(INPUT);
  });

  it("says when the application won't go through, and why", async () => {
    vi.mocked(previewAgentApplicationAction).mockResolvedValue({
      ok: false,
      error: "Some answers need fixing.",
      fieldErrors: [{ label: "Why us?", error: "This question is required." }],
    });

    render(<ApplicationApprovalDetails input={INPUT} />);

    expect(await screen.findByText(/go through: Some answers need fixing\./)).toBeInTheDocument();
    expect(screen.getByText("Why us?: This question is required.")).toBeInTheDocument();
  });
});
