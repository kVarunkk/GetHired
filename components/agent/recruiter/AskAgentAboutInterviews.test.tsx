import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { RECRUITER_TOOL_PERMISSIONS } from "@/helpers/agent/roles/recruiter/tools/permissions";
import {
  applicationInterviewSuggestions,
  applicationInterviewsPrompt,
  AskAgentAboutInterviewPlan,
  INTERVIEW_CHIP_TOOLS,
  interviewPlanSuggestions,
  scheduleHandoffPrompt,
} from "./AskAgentAboutInterviews";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const APP = { id: "e0000000-0000-4000-8000-000000000001", candidateName: "Ada Lovelace", jobTitle: "Backend Engineer" };
const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer" };
let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

const labels = (s: { label: string }[]) => s.map((x) => x.label);

describe("AskAgentAboutInterviews (IVT-086)", () => {
  it("maps every chip to a recruiter tool, gated by that tool's permission", () => {
    const gates: Record<keyof typeof INTERVIEW_CHIP_TOOLS, string> = {
      "Who still owes feedback?": "scheduling.view",
      "Summarize the feedback": "scorecards.view_all",
      "Find a time": "scheduling.manage",
      "Draft an interview plan": "interview_plans.manage",
    };
    for (const [label, tool] of Object.entries(INTERVIEW_CHIP_TOOLS)) {
      const permission = RECRUITER_TOOL_PERMISSIONS[tool];
      expect(permission, tool).toBeDefined();
      expect(permission.keys as readonly string[], label).toContain(gates[label as keyof typeof gates]);
    }
    const all = [
      ...applicationInterviewSuggestions(APP, { canSummarize: true, canSchedule: true }),
      ...interviewPlanSuggestions(JOB, { canEdit: true, canViewInterviews: true }),
    ];
    for (const { label } of all) expect(Object.keys(INTERVIEW_CHIP_TOOLS)).toContain(label);
  });

  it("hides the Interviews section's chips the viewer's permissions don't allow", () => {
    expect(labels(applicationInterviewSuggestions(APP, { canSummarize: true, canSchedule: true }))).toEqual([
      "Who still owes feedback?",
      "Summarize the feedback",
      "Find a time",
    ]);
    expect(labels(applicationInterviewSuggestions(APP, { canSummarize: false, canSchedule: false }))).toEqual([
      "Who still owes feedback?",
    ]);
  });

  it("hides the plan page's chips the viewer's permissions don't allow", () => {
    expect(labels(interviewPlanSuggestions(JOB, { canEdit: true, canViewInterviews: true }))).toEqual([
      "Draft an interview plan",
      "Who still owes feedback?",
    ]);
    expect(labels(interviewPlanSuggestions(JOB, { canEdit: false, canViewInterviews: true }))).toEqual([
      "Who still owes feedback?",
    ]);
    expect(interviewPlanSuggestions(JOB, { canEdit: false, canViewInterviews: false })).toEqual([]);
  });

  it("puts the ids in every prompt", () => {
    for (const { prompt } of applicationInterviewSuggestions(APP, { canSummarize: true, canSchedule: true })) {
      expect(prompt).toContain(`(application ${APP.id})`);
    }
    for (const { prompt } of interviewPlanSuggestions(JOB, { canEdit: true, canViewInterviews: true })) {
      expect(prompt).toContain(`(job post ${JOB.id})`);
    }
    expect(applicationInterviewsPrompt(APP, "  Book Ada ")).toBe(
      `About the interviews for Ada Lovelace's application to "Backend Engineer" (application ${APP.id}): Book Ada`,
    );
    expect(scheduleHandoffPrompt(APP.id, " Tuesday ")).toBe(`Schedule an interview for application ${APP.id}: Tuesday`);
  });

  it("opens the company agent with the question", () => {
    render(<AskAgentAboutInterviewPlan job={JOB} canEdit canViewInterviews />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), { target: { value: "Add a take-home" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(push).toHaveBeenCalledWith(
      agentPromptHref(`About the interview plan for my job post "${JOB.title}" (job post ${JOB.id}): Add a take-home`, COMPANY_AGENT_PATH),
    );
  });
});
