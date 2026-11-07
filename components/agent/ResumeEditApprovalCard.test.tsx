import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { previewAgentResumeEditAction } from "@/app/actions/resumes/preview-agent-resume-edit";
import type { ResumeDocument } from "@/helpers/resume/render/document";
import { ResumeEditApprovalDetails, isResumeEditTool } from "./ResumeEditApprovalCard";

vi.mock("@/app/actions/resumes/preview-agent-resume-edit", () => ({ previewAgentResumeEditAction: vi.fn() }));

const INPUT = { resumeId: "r1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ResumeEditApprovalDetails (RE-REQ-072)", () => {
  it("shows the summary and each change's before and after", async () => {
    vi.mocked(previewAgentResumeEditAction).mockResolvedValue({
      ok: true,
      summary: 'Change "Backend"?',
      changes: [{ label: "Experience, Engineer", before: "Old text", after: "New text" }],
    });

    render(<ResumeEditApprovalDetails tool="updateResume" input={INPUT} />);

    expect(await screen.findByText('Change "Backend"?')).toBeInTheDocument();
    expect(screen.getByText("Old text")).toBeInTheDocument();
    expect(screen.getByText("New text")).toBeInTheDocument();
    expect(previewAgentResumeEditAction).toHaveBeenCalledWith({ tool: "updateResume", input: INPUT });
  });

  it("says when a bullet goes", async () => {
    vi.mocked(previewAgentResumeEditAction).mockResolvedValue({
      ok: true,
      summary: "Change it?",
      changes: [{ label: "Experience", before: "Old text", after: "" }],
    });

    render(<ResumeEditApprovalDetails tool="updateResume" input={INPUT} />);

    expect(await screen.findByText("Removed")).toBeInTheDocument();
  });

  it("keeps resume text as plain text", async () => {
    vi.mocked(previewAgentResumeEditAction).mockResolvedValue({
      ok: true,
      summary: "Change it?",
      changes: [{ label: "Summary", before: "", after: "<img src=x onerror=alert(1)> **bold**" }],
    });

    const { container } = render(<ResumeEditApprovalDetails tool="updateResume" input={INPUT} />);

    expect(await screen.findByText("<img src=x onerror=alert(1)> **bold**")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  describe("with the resume before and after (RI-REQ-005)", () => {
    const document = (text: string): ResumeDocument => ({
      template: "classic",
      contact: [],
      sections: [
        {
          id: "s1",
          title: "Experience",
          plain: false,
          items: [{ id: "i1", title: "Engineer", bullets: [{ id: "b1", text }] }],
        },
      ],
    });

    it("shows the diff in place of the list", async () => {
      vi.mocked(previewAgentResumeEditAction).mockResolvedValue({
        ok: true,
        summary: 'Change "Backend"?',
        changes: [{ label: "Experience, Engineer", before: "Old text", after: "New text" }],
        before: document("Old text"),
        after: document("New text"),
      });

      render(<ResumeEditApprovalDetails tool="updateResume" input={INPUT} />);

      expect(await screen.findByRole("button", { name: "Full view" })).toBeInTheDocument();
      expect(screen.getByText("Engineer")).toBeInTheDocument();
      expect(screen.queryByText("Experience, Engineer")).not.toBeInTheDocument();
    });

    it("still says what the diff can't show", async () => {
      vi.mocked(previewAgentResumeEditAction).mockResolvedValue({
        ok: true,
        summary: "Change it?",
        changes: [
          { label: "Resume name", before: "Backend", after: "Stripe" },
          { label: "Experience, Engineer", before: "Old text", after: "New text" },
        ],
        before: document("Old text"),
        after: document("New text"),
      });

      render(<ResumeEditApprovalDetails tool="updateResume" input={INPUT} />);

      expect(await screen.findByText("Resume name")).toBeInTheDocument();
      expect(screen.getByText("Stripe")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Full view" })).toBeInTheDocument();
    });

    it("falls back to the list when the printed resume doesn't change", async () => {
      vi.mocked(previewAgentResumeEditAction).mockResolvedValue({
        ok: true,
        summary: "Change it?",
        changes: [{ label: "Template", before: "classic", after: "compact" }],
        before: document("Same"),
        after: document("Same"),
      });

      render(<ResumeEditApprovalDetails tool="updateResume" input={INPUT} />);

      expect(await screen.findByText("compact")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Full view" })).not.toBeInTheDocument();
    });
  });

  it("says why a change can't go through", async () => {
    vi.mocked(previewAgentResumeEditAction).mockResolvedValue({ ok: false, error: "Resume not found." });

    render(<ResumeEditApprovalDetails tool="deleteResume" input={INPUT} />);

    expect(await screen.findByText(/Resume not found\./)).toBeInTheDocument();
  });

  it("says when the preview didn't load", async () => {
    vi.mocked(previewAgentResumeEditAction).mockRejectedValue(new Error("network"));

    render(<ResumeEditApprovalDetails tool="deleteResume" input={INPUT} />);

    expect(await screen.findByText(/Couldn't load the preview/)).toBeInTheDocument();
  });
});

describe("isResumeEditTool", () => {
  it("is true only for the tools with a preview", () => {
    for (const name of ["createResume", "updateResume", "deleteResume", "applyReviewSuggestions"]) {
      expect(isResumeEditTool(name), name).toBe(true);
    }
    expect(isResumeEditTool("duplicateResume")).toBe(false);
    expect(isResumeEditTool("submitApplication")).toBe(false);
  });
});
