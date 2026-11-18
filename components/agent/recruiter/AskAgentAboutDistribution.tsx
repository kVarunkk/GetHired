"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// MPT-041: the recruiter agent's entry point on a job's Distribution section.
// The job id goes in each prompt so the agent can pass it to getDistribution /
// setDistribution. The page renders this only with agent.use and passes the
// `can(..., jobId)` boolean that hides the chip whose tool the viewer's
// permissions don't give the agent.

type JobPost = { id: string; title: string };

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

const jobPostRef = (job: JobPost) => `"${job.title}" (job post ${job.id})`;

/** Each chip's tool, for the test that every chip maps to a tool the role has. */
export const DISTRIBUTION_CHIP_TOOLS = {
  "Why isn't it live?": "getDistribution",
  "Publish on more boards": "setDistribution",
} as const;

export function distributionPrompt(job: JobPost, question: string) {
  return `About where my job post ${jobPostRef(job)} is published: ${question.trim()}`;
}

export function distributionSuggestions(job: JobPost, p: { canManage: boolean }): AgentSuggestion[] {
  const ref = jobPostRef(job);
  return [
    // getDistribution (distribution.view, which the section needs)
    {
      label: "Why isn't it live?",
      prompt: `Where is ${ref} published beyond GetHired, and what keeps it off the other channels?`,
    },
    // getDistribution, then setDistribution (distribution.manage; asks before changing)
    ...when(p.canManage, {
      label: "Publish on more boards",
      prompt: `Which job feeds could ${ref} go on that it isn't on yet? Show me before changing anything.`,
    }),
  ];
}

export function AskAgentAboutDistribution({ job, canManage }: { job: JobPost; canManage: boolean }) {
  return (
    <AskAgentBox
      title="Ask the agent about distribution"
      placeholder="Leave this job out of Jooble…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={distributionSuggestions(job, { canManage })}
      toPrompt={(question) => distributionPrompt(job, question)}
    />
  );
}
