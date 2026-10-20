"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// The job's AI interview page entry point to the recruiter agent (SIT-072).
// The job post's id goes in each prompt so the agent can pass it to its tools.
// The page itself needs interviews.view; `canManage` (interviews.manage and
// jobs.edit on the job) adds the chip for configureScreeningInterview.

type JobPost = { id: string; title: string };

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

const jobPostRef = (job: JobPost) => `"${job.title}" (job post ${job.id})`;

export function interviewQuestionPrompt(job: JobPost, question: string) {
  return `About the AI screening interview for my job post ${jobPostRef(job)}: ${question.trim()}`;
}

export function interviewSuggestions(job: JobPost, { canManage }: { canManage: boolean }): AgentSuggestion[] {
  const ref = jobPostRef(job);
  return [
    // configureScreeningInterview (asks before saving)
    ...when(canManage, {
      label: "Set up the interview",
      prompt: `Set up the AI screening interview for ${ref}: suggest competencies and must-ask questions from the post, and show me before saving.`,
    }),
    // getInterviewSetup
    { label: "How is it going?", prompt: `How is the AI interview going for ${ref}?` },
    // compareInterviewReports
    {
      label: "Compare candidates",
      prompt: `Compare the AI interview reports for ${ref}. Who did best, per competency?`,
    },
  ];
}

export default function AskAgentAboutInterview({ job, canManage }: { job: JobPost; canManage: boolean }) {
  return (
    <AskAgentBox
      title="Ask the agent about this interview"
      placeholder="Screen for Go and system design, 15 minutes…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={interviewSuggestions(job, { canManage })}
      toPrompt={(question) => interviewQuestionPrompt(job, question)}
    />
  );
}
