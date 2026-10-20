"use client";

import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox from "./agent/AskAgentBox";

// The job page's AI features, as one entry point to /agent: a question box
// plus suggested prompts. Each opens the agent with the prompt in its message
// box (the user still sends it). The job's link goes in the prompt so the
// agent can pass its id to getJobDetails, createInterview, pickResumeForJob,
// startResumeReview and findSimilarJobs. The opportunity page uses it too, for the job an
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
    { label: "Best resume for it", prompt: `Which of my resumes fits ${ref} best?` },
    {
      label: "Tailor my CV",
      prompt: `Review my resume against ${ref} and tell me what to change.`,
    },
    { label: "Similar jobs", prompt: `Find jobs similar to ${ref}.` },
  ];
}

// For the dialog shown once the user says they applied on the company's site:
// next steps for that application. createInterview, findSimilarJobs and
// getJobDetails back these.
export function appliedQuestionPrompt(job: Job, question: string) {
  return `I just applied to ${jobRef(job)}. ${question.trim()}`;
}

export function appliedSuggestions(job: Job) {
  const ref = jobRef(job);
  return [
    { label: "Prep for the interview", prompt: `I just applied to ${ref}. Set up a mock interview for it.` },
    { label: "What to expect next", prompt: `I just applied to ${ref}. What should I prepare for in their hiring process?` },
    { label: "Similar jobs", prompt: `I just applied to ${ref}. Find similar jobs I should apply to.` },
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
