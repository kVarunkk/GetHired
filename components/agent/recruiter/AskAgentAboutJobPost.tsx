"use client";

import AskAgentBox from "./AskAgentBox";

// The job post page's entry point to the recruiter agent (RA-REQ-009). The
// job post's id goes in each prompt so the agent can pass it to its tools.

type JobPost = { id: string; title: string };

const jobPostRef = (job: JobPost) => `"${job.title}" (job post ${job.id})`;

export function jobPostQuestionPrompt(job: JobPost, question: string) {
  return `About my job post ${jobPostRef(job)}: ${question.trim()}`;
}

export function jobPostSuggestions(job: JobPost) {
  const ref = jobPostRef(job);
  return [
    { label: "Find candidates", prompt: `Find and rank the best candidates for ${ref}.` },
    { label: "Strongest applicants", prompt: `Who are the strongest applicants for ${ref}?` },
    { label: "Improve the post", prompt: `Suggest improvements to the job post ${ref}.` },
  ];
}

export default function AskAgentAboutJobPost({ job }: { job: JobPost }) {
  return (
    <AskAgentBox
      title="Ask the agent about this job"
      placeholder="Who should I interview first? Is the salary competitive?…"
      suggestions={jobPostSuggestions(job)}
      toPrompt={(question) => jobPostQuestionPrompt(job, question)}
    />
  );
}
