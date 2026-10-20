import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import MessageParts from "./MessageParts";
import { previewAgentMoveAction } from "@/app/actions/pipeline/preview-agent-move";
import { previewAgentOutreachAction } from "@/app/actions/outreach/preview-agent-outreach";
import { previewAgentJobDeleteAction } from "@/app/actions/jobs/preview-agent-job-delete";
import { previewAgentInterviewInviteAction } from "@/app/actions/interviews/preview-agent-interview-invite";

vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/preview-agent-move", () => ({ previewAgentMoveAction: vi.fn() }));
vi.mock("@/app/actions/outreach/preview-agent-outreach", () => ({ previewAgentOutreachAction: vi.fn() }));
vi.mock("@/app/actions/jobs/preview-agent-job-delete", () => ({ previewAgentJobDeleteAction: vi.fn() }));
vi.mock("@/app/actions/interviews/preview-agent-interview-invite", () => ({
  previewAgentInterviewInviteAction: vi.fn(),
}));

const assistant = (parts: unknown[]): UIMessage =>
  ({ id: "a1", role: "assistant", parts }) as UIMessage;

const output = (tool: string, value: unknown, input: unknown = {}) => ({
  type: `tool-${tool}`,
  toolCallId: `c-${tool}`,
  state: "output-available",
  input,
  output: value,
});

const renderParts = (message: UIMessage) => {
  const callbacks = { onApprove: vi.fn(), onToolOutput: vi.fn() };
  render(<MessageParts message={message} {...callbacks} />);
  return callbacks;
};

const CANDIDATE = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Priya Raghunathan",
  roles: ["Frontend Engineer"],
  experienceYears: 5,
  locations: ["pune", "remote"],
  topSkills: ["React"],
  salary: "₹1500000–₹2500000",
  workStyle: [],
  url: "/company/profiles/a0000000-0000-4000-8000-000000000001?job_post=b1",
};

describe("MessageParts: recruiter results (RA-TEST-009)", () => {
  it("renders candidates as rows linking to their profile, with the match score", () => {
    renderParts(
      assistant([
        output("findMatchesForJob", {
          job: { id: "b1", title: "Frontend" },
          candidates: [{ ...CANDIDATE, rank: 1, matchScore: 88, matchSummary: "<match_explanation>\nx\n</match_explanation>" }],
        }),
      ]),
    );

    const link = screen.getByRole("link", { name: /Priya Raghunathan/ });
    expect(link).toHaveAttribute("href", CANDIDATE.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(link).getByText(/Frontend Engineer · 5 yrs/)).toBeInTheDocument();
    expect(screen.getByLabelText("Match score 88 out of 100, strong")).toBeInTheDocument();
    expect(screen.queryByText(/match_explanation/)).not.toBeInTheDocument();
  });

  it("skips candidates a comparison couldn't load", () => {
    renderParts(
      assistant([
        output("compareCandidates", {
          job: { id: "b1", title: "Frontend" },
          candidates: [CANDIDATE, { id: "x", error: "Candidate not found." }],
        }),
      ]),
    );

    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("never links a candidate URL outside the app", () => {
    renderParts(
      assistant([
        output("searchCandidates", {
          candidates: [{ ...CANDIDATE, url: "https://evil.com/x" }],
        }),
      ]),
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Priya Raghunathan")).toBeInTheDocument();
  });

  it("says when a search found no one", () => {
    renderParts(assistant([output("searchCandidates", { candidates: [] })]));

    expect(screen.getByText("No candidates found.")).toBeInTheDocument();
  });

  it("renders applicants with their job, status and fit", () => {
    renderParts(
      assistant([
        output("listApplicants", {
          applicants: [
            {
              applicationId: "e1",
              candidateId: "a1",
              name: "Ada Lovelace",
              roles: [],
              experienceYears: 4,
              job: { id: "b1", title: "Backend Engineer" },
              status: "reviewed",
              appliedAt: new Date().toISOString(),
              screening: "completed",
              fitScore: 77,
              recommendation: "yes",
              url: "/company/applications/e1",
            },
          ],
        }),
      ]),
    );

    const link = screen.getByRole("link", { name: /Ada Lovelace/ });
    expect(link).toHaveAttribute("href", "/company/applications/e1");
    expect(within(link).getByText(/Backend Engineer/)).toBeInTheDocument();
    expect(within(link).getByText(/Reviewed/)).toBeInTheDocument();
    expect(screen.getByLabelText("Match score 77 out of 100, strong")).toBeInTheDocument();
  });

  it("links a saved job post", () => {
    renderParts(
      assistant([
        output("createJobPost", {
          id: "b1",
          title: "Founding Engineer",
          status: "inactive",
          url: "/company/job-posts/b1",
        }),
      ]),
    );

    expect(screen.getByText(/Saved .*Founding Engineer.* as a draft/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the job post" })).toHaveAttribute(
      "href",
      "/company/job-posts/b1",
    );
  });

  it("shows a plan limit with an upgrade link", () => {
    renderParts(
      assistant([
        output("screenApplicants", {
          error: "PLAN_LIMIT",
          message: "You've used 100 of 100 screenings this period.",
          upgradeUrl: "/company/billing",
        }),
      ]),
    );

    expect(screen.getByText("You've used 100 of 100 screenings this period.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/company/billing");
  });

  it("renders the hiring funnel as a stage strip, with who's waiting in Applied", () => {
    renderParts(
      assistant([
        output("getHiringFunnel", {
          stages: [
            { name: "Applied", kind: "applied", count: 4 },
            { name: "Interview", kind: "interview", count: 2 },
          ],
          jobs: [],
          needsAttention: [
            { applicationId: "e1", name: "Ada", jobTitle: "Backend Engineer", daysInApplied: 5, url: "/company/applications/e1" },
          ],
        }),
      ]),
    );

    const strip = screen.getByRole("list", { name: "Pipeline funnel" });
    expect(within(strip).getByText("Applied")).toBeInTheDocument();
    expect(within(strip).getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ada" })).toHaveAttribute("href", "/company/applications/e1");
    expect(screen.getByText("Backend Engineer · 5d")).toBeInTheDocument();
  });

  it("summarises a finished move", () => {
    renderParts(
      assistant([
        output("moveApplications", {
          stage: { id: "s1", name: "Interview" },
          moved: 3,
          emailed: 2,
          skipped: [{ id: "e9", reason: "not_found" }],
        }),
      ]),
    );

    expect(screen.getByText("Moved 3 applications to Interview, emailing 2, 1 skipped")).toBeInTheDocument();
  });

  it("links to the talent list a candidate was added to", () => {
    renderParts(
      assistant([
        output("addToTalentList", {
          list: { id: "l1", name: "Backend bench" },
          created: false,
          added: true,
          url: "/company/profiles?tab=backend-bench",
        }),
      ]),
    );

    expect(screen.getByText(/Added to “Backend bench”/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the list" })).toHaveAttribute(
      "href",
      "/company/profiles?tab=backend-bench",
    );
  });

  it("confirms a sent outreach with a link to the message", () => {
    renderParts(
      assistant([
        output("sendOutreach", {
          sent: true,
          outreachId: "o1",
          status: "sent",
          emailed: true,
          candidateUrl: "/company/profiles/a1",
          outreachUrl: "/company/outreach/o1",
        }),
      ]),
    );

    expect(screen.getByText(/Message sent and emailed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open message" })).toHaveAttribute("href", "/company/outreach/o1");
  });

  it("explains when matching hasn't run for a job", () => {
    renderParts(assistant([output("findMatchesForJob", { status: "not_run", jobPostId: "b1" })]));

    expect(screen.getByText("Matching hasn't run for this job yet")).toBeInTheDocument();
  });
});

describe("MessageParts: recruiter approvals (RA-REQ-005)", () => {
  const approval = (tool: string, input: unknown) => ({
    type: `tool-${tool}`,
    toolCallId: "c1",
    state: "approval-requested",
    input,
    approval: { id: "ap1" },
  });

  const MOVE_INPUT = {
    applicationIds: ["e1", "e2", "e3", "e4", "e5", "e6", "e7"],
    stageId: "s-rej",
    email: { templateId: "t1" },
  };
  const moving = (n: number) => ({
    id: `e${n}`,
    name: `Person ${n}`,
    jobTitle: "Backend Engineer",
    moves: n !== 7,
    emailed: n !== 7,
  });

  it("shows a move's stage, names, skips and the exact email before approval (RA-REQ-005)", async () => {
    vi.mocked(previewAgentMoveAction).mockResolvedValue({
      ok: true,
      stage: { id: "s-rej", name: "Rejected", kind: "rejected" },
      applications: [1, 2, 3, 4, 5, 6, 7].map(moving),
      notFound: 1,
      email: { subject: "Your application to Backend Engineer", body: "Hi Person,\n\nThank you.", recipients: 6 },
    });
    const { onApprove } = renderParts(assistant([approval("moveApplications", MOVE_INPUT)]));

    expect(screen.getByText("Move 7 applications and email the candidates?")).toBeInTheDocument();
    // The stage, and the status candidates see.
    expect(await screen.findAllByText("Rejected")).toHaveLength(2);
    expect(previewAgentMoveAction).toHaveBeenCalledWith(MOVE_INPUT);
    expect(screen.getByText("Person 5")).toBeInTheDocument();
    expect(screen.queryByText("Person 6")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "and 1 more" }));
    expect(screen.getByText("Person 6")).toBeInTheDocument();
    expect(screen.getByText("1 already in this stage, 1 not found")).toBeInTheDocument();
    expect(screen.getByText("6 candidates")).toBeInTheDocument();
    expect(screen.getByText("Your application to Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText(/Thank you./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith({ id: "ap1", approved: true });
  });

  it("warns when the move would be refused", async () => {
    vi.mocked(previewAgentMoveAction).mockResolvedValue({
      ok: false,
      error: "Add a scheduling link in Settings, or remove {{scheduling_link}}.",
    });
    renderParts(assistant([approval("moveApplications", { applicationIds: ["e1"], stageId: "s1" })]));

    expect(screen.getByText("Move 1 application?")).toBeInTheDocument();
    expect(await screen.findByText(/won.t go through: Add a scheduling link/)).toBeInTheDocument();
  });

  const OUTREACH_INPUT = {
    candidateId: "a0000000-0000-4000-8000-000000000001",
    jobPostId: "b0000000-0000-4000-8000-000000000001",
    subject: "Backend role at Acme",
    message: "Hi Ada,\n\nYour Go work stood out. <b>Open</b> to a chat?",
  };
  const OUTREACH_PREVIEW = {
    ok: true as const,
    candidateName: "Ada Lovelace",
    acceptsOutreach: true,
    jobTitle: "Backend Engineer",
    jobFound: true,
    openSince: null,
    quota: { remaining: 12, amount: 150 },
  };

  it("shows the outreach's recipient, job, quota and full plain-text message before approval (RAT-053)", async () => {
    vi.mocked(previewAgentOutreachAction).mockResolvedValue(OUTREACH_PREVIEW);
    const { onApprove } = renderParts(assistant([approval("sendOutreach", OUTREACH_INPUT)]));

    expect(screen.getByText("Send this message on GetHired?")).toBeInTheDocument();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(previewAgentOutreachAction).toHaveBeenCalledWith(OUTREACH_INPUT);
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("12 of 150 left this month")).toBeInTheDocument();
    expect(screen.getByText("Backend role at Acme")).toBeInTheDocument();
    // Plain text: markup in the message isn't rendered.
    expect(screen.getByText(/<b>Open<\/b> to a chat\?/)).toBeInTheDocument();
    // Ids aren't shown as fields.
    expect(screen.queryByText(OUTREACH_INPUT.candidateId)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith({ id: "ap1", approved: true });
  });

  it.each([
    [{ acceptsOutreach: false }, /won.t go through: Ada Lovelace isn.t accepting outreach/],
    [{ jobFound: false, jobTitle: null }, /won.t go through: That job wasn.t found/],
    [{ quota: { remaining: 0, amount: 10 } }, /won.t go through: You.ve used this month.s outreach/],
    [{ openSince: "2026-10-10T09:00:00.000Z" }, /Ada Lovelace hasn.t answered your message from 10 Oct yet/],
  ])("warns before a send that would be refused or repeat (%o)", async (overrides, text) => {
    vi.mocked(previewAgentOutreachAction).mockResolvedValue({ ...OUTREACH_PREVIEW, ...overrides });
    renderParts(assistant([approval("sendOutreach", OUTREACH_INPUT)]));

    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("says when the candidate can't be contacted", async () => {
    vi.mocked(previewAgentOutreachAction).mockResolvedValue({
      ok: false,
      error: "This candidate isn't available to contact.",
    });
    renderParts(assistant([approval("sendOutreach", OUTREACH_INPUT)]));

    expect(await screen.findByText(/won.t go through: This candidate isn.t available/)).toBeInTheDocument();
  });

  it("shows a job post draft's fields with readable labels", () => {
    renderParts(
      assistant([
        approval("createJobPost", {
          title: "Founding Engineer",
          description: "Own the backend.",
          locations: ["Bengaluru"],
          jobType: "Fulltime",
          minSalary: 3000000,
          maxSalary: 4000000,
          visaSponsorship: "Not Required",
        }),
      ]),
    );

    expect(screen.getByText("Create this job post as a draft?")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Founding Engineer")).toBeInTheDocument();
    expect(screen.getByText("Visa sponsorship")).toBeInTheDocument();
  });

  it("asks before publishing a job post", () => {
    renderParts(assistant([approval("setJobPostStatus", { jobPostId: "b1", status: "active" })]));

    expect(screen.getByText("Publish this job post?")).toBeInTheDocument();
  });

  it("names the job and its applications before deleting it", async () => {
    vi.mocked(previewAgentJobDeleteAction).mockResolvedValue({
      ok: true,
      title: "Backend Engineer",
      status: "active",
      applications: 4,
    });
    renderParts(assistant([approval("deleteJobPost", { jobPostId: "b0000000-0000-4000-8000-000000000001" })]));

    expect(screen.getByText("Delete this job post?")).toBeInTheDocument();
    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText(/The 4 applications and their notes are deleted too/)).toBeInTheDocument();
    // The id isn't shown as a field.
    expect(screen.queryByText("b0000000-0000-4000-8000-000000000001")).not.toBeInTheDocument();
  });

  it("warns before a delete that would be refused", async () => {
    vi.mocked(previewAgentJobDeleteAction).mockResolvedValue({ ok: false, error: "Your role can't delete job posts." });
    renderParts(assistant([approval("deleteJobPost", { jobPostId: "b1" })]));

    expect(await screen.findByText(/won.t go through: Your role can.t delete job posts/)).toBeInTheDocument();
  });

  it("confirms a deleted job post by title", () => {
    renderParts(assistant([output("deleteJobPost", { id: "b1", title: "Backend Engineer", deleted: true })]));

    expect(screen.getByText("Deleted “Backend Engineer”.")).toBeInTheDocument();
  });

  it("asks before withdrawing an outreach message, without showing its id", () => {
    renderParts(assistant([approval("withdrawOutreach", { outreachId: "f0000000-0000-4000-8000-000000000009" })]));

    expect(screen.getByText(/^Withdraw this message\? The candidate won.t be able to answer it/)).toBeInTheDocument();
    expect(screen.queryByText("f0000000-0000-4000-8000-000000000009")).not.toBeInTheDocument();
  });

  it("asks before deleting a note, without showing its id", () => {
    renderParts(assistant([approval("deleteNote", { noteId: "70e00000-0000-4000-8000-0000000000aa" })]));

    expect(screen.getByText("Delete this note? This can't be undone.")).toBeInTheDocument();
    expect(screen.queryByText("70e00000-0000-4000-8000-0000000000aa")).not.toBeInTheDocument();
  });

  it("asks before archiving a stage, without showing its id", () => {
    renderParts(assistant([approval("archiveStage", { stageId: "f0000000-0000-4000-8000-0000000000a3" })]));

    expect(screen.getByText("Archive this stage? It leaves your pipeline and can't be brought back.")).toBeInTheDocument();
    expect(screen.queryByText("f0000000-0000-4000-8000-0000000000a3")).not.toBeInTheDocument();
  });

  it("asks before deleting an email template, without showing its id", () => {
    renderParts(assistant([approval("deleteEmailTemplate", { templateId: "d0000000-0000-4000-8000-000000000001" })]));

    expect(screen.getByText("Delete this email template? This can't be undone.")).toBeInTheDocument();
    expect(screen.queryByText("d0000000-0000-4000-8000-000000000001")).not.toBeInTheDocument();
  });

  it("asks before deleting a talent list, without showing its id", () => {
    renderParts(assistant([approval("deleteTalentList", { listId: "f0000000-0000-4000-8000-000000000001" })]));

    expect(screen.getByText(/^Delete this talent list\? Its candidates stay in the talent pool/)).toBeInTheDocument();
    expect(screen.queryByText("f0000000-0000-4000-8000-000000000001")).not.toBeInTheDocument();
  });
});

describe("MessageParts: screening interview approvals (SIT-071)", () => {
  const approval = (tool: string, input: unknown) => ({
    type: `tool-${tool}`,
    toolCallId: "c1",
    state: "approval-requested",
    input,
    approval: { id: "ap1" },
  });

  it("shows the exact interview setup before approval", () => {
    renderParts(
      assistant([
        approval("configureScreeningInterview", {
          jobPostId: "b1",
          enabled: true,
          inviteRule: "fit_threshold",
          fitThreshold: 75,
          questions: ["Why this team?"],
          competencies: [{ name: "System design", description: "Designs services that scale." }],
          durationMinutes: 20,
          deadlineDays: 7,
        }),
      ]),
    );

    expect(screen.getByText("Set up this AI interview?")).toBeInTheDocument();
    expect(screen.getByText("Applicants scoring at least 75")).toBeInTheDocument();
    expect(screen.getByText("System design")).toBeInTheDocument();
    expect(screen.getByText("Designs services that scale.")).toBeInTheDocument();
    expect(screen.getByText("Why this team?")).toBeInTheDocument();
    expect(screen.getByText("20 minutes")).toBeInTheDocument();
    expect(screen.getByText("7 days")).toBeInTheDocument();
  });

  it("shows who'd be invited, who wouldn't, and the minutes held", async () => {
    vi.mocked(previewAgentInterviewInviteAction).mockResolvedValue({
      ok: true,
      totalMinutes: 30,
      applicants: [
        { id: "e1", name: "Ada", jobTitle: "Backend Engineer", invite: true, minutes: 15 },
        { id: "e2", name: "Grace", jobTitle: "Backend Engineer", invite: true, minutes: 15 },
        { id: "e3", name: "Alan", jobTitle: "Backend Engineer", invite: false, message: "Already invited." },
      ],
    });
    renderParts(assistant([approval("inviteToInterview", { applicationIds: ["e1", "e2", "e3"] })]));

    expect(screen.getByText("Invite 3 applicants to the AI interview?")).toBeInTheDocument();
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText(/Alan/)).toBeInTheDocument();
    expect(screen.getByText(/Already invited./)).toBeInTheDocument();
    expect(screen.getByText(/30 interview minutes/)).toBeInTheDocument();
  });
});
