"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// The job post page's entry point to the recruiter agent (RA-REQ-009). The
// job post's id goes in each prompt so the agent can pass it to its tools.
// The page passes `can(..., job.id)` booleans that hide the chips whose tools
// the viewer's permissions don't give the agent.

type JobPost = { id: string; title: string };
type Allowed = { canMatch: boolean; canViewApplicants: boolean };

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

const jobPostRef = (job: JobPost) => `"${job.title}" (job post ${job.id})`;

export function jobPostQuestionPrompt(job: JobPost, question: string) {
  return `About my job post ${jobPostRef(job)}: ${question.trim()}`;
}

export function jobPostSuggestions(job: JobPost, p: Allowed): AgentSuggestion[] {
  const ref = jobPostRef(job);
  return [
    // findMatchesForJob
    ...when(p.canMatch, { label: "Find candidates", prompt: `Find and rank the best candidates for ${ref}.` }),
    // listApplicants / getHiringFunnel
    ...when(p.canViewApplicants, { label: "Strongest applicants", prompt: `Who are the strongest applicants for ${ref}?` }),
    // getJobPost (jobs.view, which the page itself needs)
    { label: "Improve the post", prompt: `Suggest improvements to the job post ${ref}.` },
  ];
}

export default function AskAgentAboutJobPost({ job, ...allowed }: { job: JobPost } & Allowed) {
  return (
    <AskAgentBox
      title="Ask the agent about this job"
      placeholder="Who should I interview first? Is the salary competitive?…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={jobPostSuggestions(job, allowed)}
      toPrompt={(question) => jobPostQuestionPrompt(job, question)}
    />
  );
}
