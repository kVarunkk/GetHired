import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import MessageParts from "./MessageParts";

vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));

const assistant = (parts: unknown[]): UIMessage =>
  ({ id: "a1", role: "assistant", parts }) as UIMessage;

const renderParts = (message: UIMessage) => {
  const callbacks = { onApprove: vi.fn(), onToolOutput: vi.fn() };
  render(<MessageParts message={message} {...callbacks} />);
  return callbacks;
};

describe("MessageParts", () => {
  it("renders assistant text as markdown", () => {
    renderParts(assistant([{ type: "text", text: "Here is **one** job" }]));

    expect(screen.getByText("one").tagName).toBe("STRONG");
  });

  it("opens every link in a new tab", () => {
    renderParts(
      assistant([
        { type: "text", text: "See [your dashboard](/dashboard) or [Stripe](https://stripe.com)." },
        {
          type: "tool-searchJobs",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { jobs: [{ id: "j1", title: "Frontend Engineer", company: "Acme", url: "/jobs/j1" }] },
        },
        {
          type: "tool-startResumeReview",
          toolCallId: "c2",
          state: "output-available",
          input: {},
          output: { reviewId: "rev1", status: "processing", url: "/resume-review/rev1" },
        },
      ]),
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("renders user text as plain text", () => {
    renderParts({ id: "u1", role: "user", parts: [{ type: "text", text: "**not bold**" }] });

    expect(screen.getByText("**not bold**")).toBeInTheDocument();
  });

  it("renders job results as cards linking to the job page", () => {
    renderParts(
      assistant([
        {
          type: "tool-searchJobs",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: {
            jobs: [
              { id: "j1", title: "Frontend Engineer", company: "Acme", locations: ["Remote"], salary: "$120k", url: "/jobs/j1" },
            ],
            totalCount: 1,
          },
        },
      ]),
    );

    const link = screen.getByRole("link", { name: /Frontend Engineer/ });
    expect(link).toHaveAttribute("href", "/jobs/j1");
    expect(link).toHaveTextContent("Acme");
    expect(link).toHaveTextContent("Remote");
    expect(link).toHaveTextContent("$120k");
  });

  describe("long job lists", () => {
    const jobs = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `j${i + 1}`,
        title: `Job ${i + 1}`,
        company: "Acme",
        url: `/jobs/j${i + 1}`,
      }));
    const renderJobs = (count: number) =>
      renderParts(
        assistant([
          {
            type: "tool-searchJobs",
            toolCallId: "c1",
            state: "output-available",
            input: {},
            output: { jobs: jobs(count), totalCount: count },
          },
        ]),
      );

    it("shows the first 10 and reveals the rest on demand", async () => {
      renderJobs(14);

      expect(screen.getAllByRole("link")).toHaveLength(10);
      expect(screen.queryByRole("link", { name: /Job 11/ })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Show 4 more jobs" }));
      expect(screen.getAllByRole("link")).toHaveLength(14);

      await userEvent.click(screen.getByRole("button", { name: "Show fewer jobs" }));
      expect(screen.getAllByRole("link")).toHaveLength(10);
    });

    it("has no toggle for 10 jobs or fewer", () => {
      renderJobs(10);

      expect(screen.getAllByRole("link")).toHaveLength(10);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  it("shows a running state while a tool executes", () => {
    renderParts(
      assistant([{ type: "tool-searchJobs", toolCallId: "c1", state: "input-available", input: {} }]),
    );

    expect(screen.getByText("Searching jobs…")).toBeInTheDocument();
  });

  it("asks for approval and reports the decision", async () => {
    const { onApprove } = renderParts(
      assistant([
        {
          type: "tool-startResumeReview",
          toolCallId: "c1",
          state: "approval-requested",
          input: { resumeId: "r1", jobId: "j1" },
          approval: { id: "ap1" },
        },
      ]),
    );

    expect(screen.getByText(/Start a resume review/)).toBeInTheDocument();
    expect(screen.getByText(/5 AI credits/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith({ id: "ap1", approved: true });

    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onApprove).toHaveBeenCalledWith({ id: "ap1", approved: false });
  });

  it("describes preference changes awaiting approval", () => {
    renderParts(
      assistant([
        {
          type: "tool-updateMyPreferences",
          toolCallId: "c1",
          state: "approval-requested",
          input: { desiredRoles: ["Backend Engineer"], minSalary: 100000 },
          approval: { id: "ap2" },
        },
      ]),
    );

    expect(screen.getByText(/Update your job preferences/)).toBeInTheDocument();
    expect(screen.getByText(/Backend Engineer/)).toBeInTheDocument();
  });

  it("asks to approve onboarding with readable field names", () => {
    renderParts(
      assistant([
        {
          type: "tool-completeOnboarding",
          toolCallId: "c1",
          state: "approval-requested",
          input: {
            fullName: "Ada Lovelace",
            preferredLocations: ["Bangalore", "Remote"],
            companySizePreference: "Any",
            visaSponsorshipRequired: false,
            resumeId: "22222222-2222-4222-8222-222222222222",
          },
          approval: { id: "ap3" },
        },
      ]),
    );

    expect(screen.getByText("Set up your profile with these details?")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Locations")).toBeInTheDocument();
    expect(screen.getByText("Bangalore, Remote")).toBeInTheDocument();
    expect(screen.getByText("Needs visa sponsorship")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    // The resume id means nothing to the user.
    expect(screen.queryByText(/2222-4222/)).not.toBeInTheDocument();
  });

  it("confirms onboarding is done and links the resume it used", () => {
    renderParts(
      assistant([
        {
          type: "tool-completeOnboarding",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: {
            onboarded: true,
            resume: { id: "r1", name: "CV 2026" },
            preferredLocations: ["Bengaluru"],
          },
        },
      ]),
    );

    expect(screen.getByText(/Profile set up with/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "CV 2026" });
    expect(link).toHaveAttribute("href", "/resume/r1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  describe("resume on the onboarding approval card", () => {
    const RESUMES = [
      { id: "r-old", name: "Old CV", is_primary: false },
      { id: "r-primary", name: "Primary CV", is_primary: true },
    ];

    const stubResumes = (response: Promise<Response>) =>
      vi.stubGlobal("fetch", vi.fn(() => response));

    const approvalWith = (input: Record<string, unknown>) =>
      renderParts(
        assistant([
          {
            type: "tool-completeOnboarding",
            toolCallId: "c1",
            state: "approval-requested",
            input: { fullName: "Ada Lovelace", ...input },
            approval: { id: "ap3" },
          },
        ]),
      );

    afterEach(() => vi.unstubAllGlobals());

    it("shows the chosen resume, linked so it can be checked", async () => {
      stubResumes(Promise.resolve(new Response(JSON.stringify({ data: RESUMES }))));

      approvalWith({ resumeId: "r-old" });

      const link = await screen.findByRole("link", { name: "Old CV" });
      expect(link).toHaveAttribute("href", "/resume/r-old");
      expect(link).toHaveAttribute("target", "_blank");
      expect(screen.getByText("Resume")).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith("/api/resumes");
    });

    it("shows the primary resume when none was chosen, as the tool will use it", async () => {
      stubResumes(Promise.resolve(new Response(JSON.stringify({ data: RESUMES }))));

      approvalWith({});

      expect(await screen.findByRole("link", { name: "Primary CV" })).toHaveAttribute(
        "href",
        "/resume/r-primary",
      );
    });

    it("says when there's no resume yet", async () => {
      stubResumes(Promise.resolve(new Response(JSON.stringify({ data: [] }))));

      approvalWith({});

      expect(
        await screen.findByText("None yet. The assistant will ask you to upload one."),
      ).toBeInTheDocument();
    });

    it("degrades gracefully when the resumes can't be loaded", async () => {
      stubResumes(Promise.resolve(new Response("{}", { status: 500 })));

      approvalWith({ resumeId: "r-old" });

      expect(await screen.findByText("Couldn't load the resume.")).toBeInTheDocument();
    });
  });

  it("renders the upload widget for requestResumeUpload", () => {
    renderParts(
      assistant([
        {
          type: "tool-requestResumeUpload",
          toolCallId: "c-up",
          state: "input-available",
          input: { reason: "so I can review it" },
        },
      ]),
    );

    expect(screen.getByText("so I can review it")).toBeInTheDocument();
    expect(screen.getByLabelText("Resume PDF")).toBeInTheDocument();
  });

  it("links to the recharge page for insufficient credits", () => {
    renderParts(
      assistant([
        {
          type: "tool-naturalLanguageJobSearch",
          toolCallId: "c1",
          state: "output-available",
          input: { query: "x" },
          output: { error: "INSUFFICIENT_CREDITS", message: "Not enough AI credits for this action.", rechargeUrl: "/dashboard/buy-credits" },
        },
      ]),
    );

    expect(screen.getByRole("link", { name: /Buy credits/ })).toHaveAttribute(
      "href",
      "/dashboard/buy-credits",
    );
  });

  it("shows tool errors", () => {
    renderParts(
      assistant([
        { type: "tool-saveJob", toolCallId: "c1", state: "output-available", input: {}, output: { error: "Job not found." } },
        { type: "tool-saveJob", toolCallId: "c2", state: "output-error", input: {}, errorText: "Invalid input" },
      ]),
    );

    expect(screen.getByText("Job not found.")).toBeInTheDocument();
    expect(screen.getByText("Couldn't save the job.")).toBeInTheDocument();
  });

  it("shows completed and declined actions", () => {
    renderParts(
      assistant([
        { type: "tool-saveJob", toolCallId: "c1", state: "output-available", input: {}, output: { jobId: "j1", saved: true } },
        { type: "tool-updateMyPreferences", toolCallId: "c2", state: "output-denied", input: {}, approval: { id: "a", approved: false } },
      ]),
    );

    expect(screen.getByText("Saved the job")).toBeInTheDocument();
    expect(screen.getByText("Declined: update your job preferences")).toBeInTheDocument();
  });

  it("links to a started resume review", () => {
    renderParts(
      assistant([
        {
          type: "tool-startResumeReview",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { reviewId: "rev1", status: "processing", url: "/resume-review/rev1" },
        },
      ]),
    );

    expect(screen.getByRole("link", { name: /Open the review/ })).toHaveAttribute(
      "href",
      "/resume-review/rev1",
    );
  });

  it("links to an uploaded resume", () => {
    renderParts(
      assistant([
        {
          type: "tool-requestResumeUpload",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { resumeId: "r9" },
        },
      ]),
    );

    expect(screen.getByRole("link", { name: /Open the resume/ })).toHaveAttribute(
      "href",
      "/resume/r9",
    );
  });

  it("shows a cancelled resume upload", () => {
    renderParts(
      assistant([
        {
          type: "tool-requestResumeUpload",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { cancelled: true },
        },
      ]),
    );

    expect(screen.getByText("Resume upload cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links to a newly created interview", () => {
    renderParts(
      assistant([
        {
          type: "tool-createInterview",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { interviewId: "i1", url: "/interview/i1", message: "ready" },
        },
      ]),
    );

    expect(screen.getByRole("link", { name: /Start the interview/ })).toHaveAttribute(
      "href",
      "/interview/i1",
    );
  });

  it("links to a completed interview analysis", () => {
    renderParts(
      assistant([
        {
          type: "tool-getInterviewAnalysis",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { status: "completed", url: "/interview/i1/analysis/s1" },
        },
      ]),
    );

    expect(screen.getByRole("link", { name: /Open the full analysis/ })).toHaveAttribute(
      "href",
      "/interview/i1/analysis/s1",
    );
  });

  it("falls back to a generic label for unknown tools", () => {
    renderParts(
      assistant([{ type: "tool-mysteryTool", toolCallId: "c1", state: "output-available", input: {}, output: { ok: true } }]),
    );

    expect(screen.getByText("Done: mysteryTool")).toBeInTheDocument();
  });

  it("ignores step markers", () => {
    const { container } = render(
      <MessageParts message={assistant([{ type: "step-start" }])} onApprove={vi.fn()} onToolOutput={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
