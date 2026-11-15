"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// IVT-086: the recruiter agent's entry points for interviews with people: an
// application's Interviews section and a job's Interview plan. Ids go in each
// prompt so the agent can pass them to its tools. The pages render these only
// with agent.use and pass `can(..., jobId)` booleans that hide the chips whose
// tools the viewer's permissions don't give the agent.

type Application = { id: string; candidateName: string | null; jobTitle: string | null };
type JobPost = { id: string; title: string };

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

const applicationRef = (a: Application) =>
  `${a.candidateName ?? "the applicant"}'s application${a.jobTitle ? ` to "${a.jobTitle}"` : ""} (application ${a.id})`;
const jobPostRef = (job: JobPost) => `"${job.title}" (job post ${job.id})`;

/** Each chip's tool, for the test that every chip maps to a tool the role has. */
export const INTERVIEW_CHIP_TOOLS = {
  "Who still owes feedback?": "listScheduledInterviews",
  "Summarize the feedback": "summarizeFeedback",
  "Find a time": "findInterviewSlots",
  "Draft an interview plan": "draftInterviewPlan",
} as const;

export function applicationInterviewsPrompt(a: Application, question: string) {
  return `About the interviews for ${applicationRef(a)}: ${question.trim()}`;
}

export function applicationInterviewSuggestions(
  a: Application,
  p: { canSummarize: boolean; canSchedule: boolean },
): AgentSuggestion[] {
  const ref = applicationRef(a);
  return [
    // listScheduledInterviews (scheduling.view, which the section needs)
    {
      label: "Who still owes feedback?",
      prompt: `Which interviewers still owe feedback on the interviews for ${ref}?`,
    },
    // summarizeFeedback (scorecards.view_all)
    ...when(p.canSummarize, {
      label: "Summarize the feedback",
      prompt: `Summarize the interview feedback on ${ref}: where the panel agrees, where it disagrees, and open concerns.`,
    }),
    // findInterviewSlots, then scheduleInterview (scheduling.manage; asks before booking)
    ...when(p.canSchedule, {
      label: "Find a time",
      prompt: `Find a time for the next interview in the plan for ${ref}, and show me before booking.`,
    }),
  ];
}

export function AskAgentAboutApplicationInterviews({
  application,
  canSummarize,
  canSchedule,
}: {
  application: Application;
  canSummarize: boolean;
  canSchedule: boolean;
}) {
  return (
    <AskAgentBox
      title="Ask the agent about these interviews"
      placeholder="Book the system design interview next week…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={applicationInterviewSuggestions(application, { canSummarize, canSchedule })}
      toPrompt={(question) => applicationInterviewsPrompt(application, question)}
    />
  );
}

/** The schedule page's AgentHandoff prompt: the typed request about this application. */
export function scheduleHandoffPrompt(applicationId: string, text: string) {
  return `Schedule an interview for application ${applicationId}: ${text.trim()}`;
}

export function interviewPlanPrompt(job: JobPost, question: string) {
  return `About the interview plan for my job post ${jobPostRef(job)}: ${question.trim()}`;
}

export function interviewPlanSuggestions(
  job: JobPost,
  p: { canEdit: boolean; canViewInterviews: boolean },
): AgentSuggestion[] {
  const ref = jobPostRef(job);
  return [
    // draftInterviewPlan (interview_plans.manage), then saveInterviewPlan (asks)
    ...when(p.canEdit, {
      label: "Draft an interview plan",
      prompt: `Draft an interview plan for ${ref} from the job post, and show me before saving.`,
    }),
    // listScheduledInterviews by job (scheduling.view)
    ...when(p.canViewInterviews, {
      label: "Who still owes feedback?",
      prompt: `Which interviewers still owe feedback on interviews for ${ref}?`,
    }),
  ];
}

export function AskAgentAboutInterviewPlan({
  job,
  canEdit,
  canViewInterviews,
}: {
  job: JobPost;
  canEdit: boolean;
  canViewInterviews: boolean;
}) {
  return (
    <AskAgentBox
      title="Ask the agent about this plan"
      placeholder="Add a take-home review before the onsite…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={interviewPlanSuggestions(job, { canEdit, canViewInterviews })}
      toPrompt={(question) => interviewPlanPrompt(job, question)}
    />
  );
}
