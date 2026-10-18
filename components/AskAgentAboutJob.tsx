"use client";

import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox from "./agent/AskAgentBox";

// The job page's AI features, as one entry point to /agent: a question box
// plus suggested prompts. Each opens the agent with the prompt in its message
// box (the user still sends it). The job's link goes in the prompt so the
// agent can pass its id to getJobDetails, createInterview, startResumeReview
// and findSimilarJobs. The opportunity page uses it too, for the job an
// outreach is about.

type Job = { id: string; job_name: string | null; company_name: string | null };

const jobRef = (job: Job) =>
  `the ${job.job_name ?? "this"} role${job.company_name ? ` at ${job.company_name}` : ""} (/jobs/${job.id})`;

export function jobQuestionPrompt(job: Job, question: string) {
  return `About ${jobRef(job)}: ${question.trim()}`;
}

export function jobSuggestions(job: Job) {
  const ref = jobRef(job);
  return [
    { label: "Mock interview", prompt: `Set up a mock interview for ${ref}.` },
    {
      label: "Tailor my CV",
      prompt: `Review my resume against ${ref} and tell me what to change.`,
    },
    { label: "Similar jobs", prompt: `Find jobs similar to ${ref}.` },
  ];
}

export default function AskAgentAboutJob({ job }: { job: Job }) {
  return (
    <AskAgentBox
      title="Ask the agent about this job"
      placeholder="Am I a good fit? What does this team work on?…"
      basePath={AGENT_PATH}
      suggestions={jobSuggestions(job)}
      toPrompt={(question) => jobQuestionPrompt(job, question)}
    />
  );
}
